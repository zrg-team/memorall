import { logInfo, logWarn } from "@/utils/logger";
import type { ModelsResponse } from "./interfaces/base-llm";

export interface ResidencyManagerDeps {
	/** Registered service names. */
	list(): string[];
	/** Whether the service keeps weights in this browser's memory. */
	isResidentLocal(serviceName: string): boolean;
	/** Only called for services that are already registered. */
	modelsFor(serviceName: string): Promise<ModelsResponse>;
	unloadFor(serviceName: string, modelId: string): Promise<void>;
	/**
	 * Tear the runner down after its model is unloaded. A WASM heap never
	 * shrinks, so for runners that grow one per model this is the only way to
	 * actually give the memory back.
	 */
	releaseRunner?(serviceName: string): void;
	/**
	 * Whether the service's runner is running at all. A stopped runner holds
	 * nothing, and asking it for its models would only start it again.
	 */
	isRunnerActive?(serviceName: string): boolean;
}

export interface ResidencyManagerOptions {
	/**
	 * Longest a switch waits for in-flight work on the current model. Without
	 * a bound, an operation that holds one model while it asks for another
	 * would wait on itself forever.
	 */
	drainTimeoutMs?: number;
}

export class ResidencyBusyError extends Error {
	constructor(busy: string, requested: string) {
		super(
			`Another on-device model (${busy}) is still busy, so ${requested} cannot be loaded yet. Try again when it finishes.`,
		);
		this.name = "ResidencyBusyError";
	}
}

const DEFAULT_DRAIN_TIMEOUT_MS = 10 * 60_000;

type ResidentKey = `${string}::${string}`;

const keyOf = (serviceName: string, modelId: string): ResidentKey =>
	`${serviceName}::${modelId.toLowerCase()}`;

/**
 * Keeps at most one browser-hosted model in memory across every local runner.
 *
 * A chat model, a speech model and an image model each want gigabytes; two of
 * them loaded together is how a tab gets killed. Every operation that needs a
 * local model - serving it, chatting with it, synthesizing with it - leases it
 * here first. Switching to another model waits for in-flight operations on the
 * current one to finish (a stream is never cut off) and then unloads it.
 *
 * Remote providers and local servers (Ollama, LM Studio) hold no memory here
 * and pass straight through, as does the embedding runner, which knowledge
 * jobs need constantly and which is small.
 */
export class ResidencyManager {
	private resident: { serviceName: string; modelId: string } | null = null;
	private readonly leases = new Map<ResidentKey, number>();
	private readonly drainWaiters = new Map<ResidentKey, (() => void)[]>();
	private switchQueue: Promise<void> = Promise.resolve();

	private readonly drainTimeoutMs: number;

	constructor(
		private readonly deps: ResidencyManagerDeps,
		options: ResidencyManagerOptions = {},
	) {
		this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
	}

	get current(): { serviceName: string; modelId: string } | null {
		return this.resident;
	}

	/**
	 * Lease `modelId` on `serviceName` for one operation. Resolves once every
	 * other local model is out of memory; call the returned function when the
	 * operation (including a stream) finishes.
	 */
	async acquire(serviceName: string, modelId: string): Promise<() => void> {
		if (!this.deps.isResidentLocal(serviceName) || !modelId) {
			return () => undefined;
		}

		const key = keyOf(serviceName, modelId);

		// Serialize switches so two requests for different models cannot both
		// decide they are the resident and load side by side.
		const switching = this.switchQueue.then(() =>
			this.makeResident(serviceName, modelId, key),
		);
		this.switchQueue = switching.catch(() => undefined);
		await switching;

		this.leases.set(key, (this.leases.get(key) ?? 0) + 1);

		let released = false;
		return () => {
			if (released) return;
			released = true;
			const remaining = (this.leases.get(key) ?? 1) - 1;
			if (remaining > 0) {
				this.leases.set(key, remaining);
				return;
			}
			this.leases.delete(key);
			const waiters = this.drainWaiters.get(key);
			this.drainWaiters.delete(key);
			waiters?.forEach((resolve) => resolve());
		};
	}

	/**
	 * Unload every local model once in-flight work on it finishes. Used when
	 * the user switches to a remote model: nothing local is needed any more,
	 * and keeping gigabytes resident until an idle timer fires helps no one.
	 */
	async releaseAll(): Promise<void> {
		const releasing = this.switchQueue.then(async () => {
			const previous = this.resident;
			if (previous) {
				await this.waitForDrain(
					keyOf(previous.serviceName, previous.modelId),
					"a remote model",
				);
			}
			await this.evictAllExcept(null);
			this.resident = null;
		});
		this.switchQueue = releasing.catch(() => undefined);
		await releasing;
	}

	/** Forget the resident, e.g. after the user unloads it by hand. */
	forget(serviceName: string, modelId?: string): void {
		if (!this.resident || this.resident.serviceName !== serviceName) return;
		if (
			modelId &&
			this.resident.modelId.toLowerCase() !== modelId.toLowerCase()
		) {
			return;
		}
		this.resident = null;
	}

	private async makeResident(
		serviceName: string,
		modelId: string,
		key: ResidentKey,
	): Promise<void> {
		const previous = this.resident;
		if (previous && keyOf(previous.serviceName, previous.modelId) === key) {
			return;
		}

		if (previous) {
			await this.waitForDrain(
				keyOf(previous.serviceName, previous.modelId),
				`${serviceName}/${modelId}`,
			);
		}

		await this.evictAllExcept({ serviceName, modelId });
		this.resident = { serviceName, modelId };
	}

	private waitForDrain(key: ResidentKey, requested: string): Promise<void> {
		if (!this.leases.get(key)) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(() => {
				const waiters = this.drainWaiters.get(key) ?? [];
				this.drainWaiters.set(
					key,
					waiters.filter((waiter) => waiter !== done),
				);
				reject(new ResidencyBusyError(key.replace("::", "/"), requested));
			}, this.drainTimeoutMs);
			const waiters = this.drainWaiters.get(key) ?? [];
			waiters.push(done);
			this.drainWaiters.set(key, waiters);
		});
	}

	/**
	 * Ask every local runner what it actually holds rather than trusting
	 * `resident`: runners unload on their own idle timers and a model can be
	 * loaded by a path that predates this manager.
	 */
	private async evictAllExcept(
		keep: { serviceName: string; modelId: string } | null,
	): Promise<void> {
		const target = keep ? keyOf(keep.serviceName, keep.modelId) : null;
		const reason = keep
			? `${keep.serviceName}/${keep.modelId}`
			: "a remote model";

		for (const name of this.deps.list()) {
			if (!this.deps.isResidentLocal(name)) continue;
			if (this.deps.isRunnerActive && !this.deps.isRunnerActive(name)) continue;

			let models: ModelsResponse;
			try {
				models = await this.deps.modelsFor(name);
			} catch (error) {
				logWarn(`[residency] could not list models for ${name}`, error);
				continue;
			}

			let unloadedAny = false;
			for (const model of models.data) {
				if (!model.loaded || keyOf(name, model.id) === target) continue;
				try {
					logInfo(`[residency] unloading ${name}/${model.id} for ${reason}`);
					await this.deps.unloadFor(name, model.id);
					unloadedAny = true;
				} catch (error) {
					logWarn(`[residency] failed to unload ${name}/${model.id}`, error);
				}
			}

			// Also when switching models inside the same runner: a runner whose
			// memory only returns on teardown would otherwise stay at its peak.
			// The next request starts it again.
			if (unloadedAny) {
				this.deps.releaseRunner?.(name);
			}
		}
	}
}
