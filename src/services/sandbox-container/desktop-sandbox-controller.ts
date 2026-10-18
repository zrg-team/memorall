import type {
	SandboxRuntimePort,
	SandboxRuntimeStatus,
} from "@/platform/contracts/core";
import { errorMessage } from "@/utils/error-message";

export interface DesktopSandboxState {
	status: SandboxRuntimeStatus | null;
	action: "starting" | "stopping" | null;
	error: string | null;
}

/** One lifecycle per native runtime, shared by every PC and status view. */
export class DesktopSandboxController {
	private state: DesktopSandboxState = {
		status: null,
		action: null,
		error: null,
	};
	private listeners = new Set<() => void>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private revision = 0;
	private refreshing = false;
	private actionFailure: string | null = null;
	private starting: Promise<void> | null = null;
	private stopping: Promise<void> | null = null;
	private stoppedByUser = false;
	constructor(private readonly runtime: SandboxRuntimePort) {}
	getSnapshot = (): DesktopSandboxState => this.state;
	private update(patch: Partial<DesktopSandboxState>) {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		if (!this.timer) {
			void this.refresh();
			this.timer = setInterval(() => void this.refresh(), 1000);
		}
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size && this.timer) {
				clearInterval(this.timer);
				this.timer = null;
			}
		};
	};
	refresh = async (): Promise<void> => {
		if (this.refreshing) return;
		this.refreshing = true;
		const revision = this.revision;
		try {
			const status = await this.runtime.status();
			if (revision === this.revision)
				this.update({
					status,
					error: this.actionFailure,
				});
		} catch (error) {
			if (revision === this.revision)
				this.update({ error: errorMessage(error) });
		} finally {
			this.refreshing = false;
		}
	};
	start = (options: { automatic?: boolean } = {}): Promise<void> => {
		if (options.automatic && this.stoppedByUser) return Promise.resolve();
		if (this.stopping) return this.stopping;
		if (this.starting) return this.starting;
		if (this.state.status?.ready && !this.state.error) return Promise.resolve();
		this.stoppedByUser = false;
		const revision = ++this.revision;
		this.actionFailure = null;
		this.update({ action: "starting", error: null });
		const operation = Promise.resolve().then(async () => {
			try {
				// Desktop files render independently, while readiness includes the
				// saved workspace so the first commands do not pay its restore cost.
				await this.runtime.request("health", undefined, 300_000);
				if (revision !== this.revision) return;
				const { serviceManager } = await import("@/services");
				await serviceManager.getSandboxContainerService()?.prepareWorkspace?.();
				const status = await this.runtime.status();
				if (revision === this.revision) this.update({ status, action: null });
			} catch (error) {
				if (revision === this.revision) {
					this.actionFailure = errorMessage(error);
					this.update({ action: null, error: this.actionFailure });
				}
			} finally {
				if (this.starting === operation) this.starting = null;
			}
		});
		this.starting = operation;
		return operation;
	};
	stop = (): Promise<void> => {
		this.stoppedByUser = true;
		if (this.stopping) return this.stopping;
		const wasStarting =
			this.state.action === "starting" ||
			this.state.status?.state === "starting";
		const revision = ++this.revision;
		this.actionFailure = null;
		this.update({ action: "stopping", error: null });
		const boot = this.starting;
		const operation = Promise.resolve().then(async () => {
			try {
				if (wasStarting) {
					await this.runtime.stop();
					const { serviceManager } = await import("@/services");
					await serviceManager.getSandboxContainerService()?.dispose();
				} else {
					const { serviceManager } = await import("@/services");
					await serviceManager.getSandboxContainerService().dispose();
				}
				await boot;
				const status = await this.runtime.status();
				if (revision === this.revision) this.update({ status, action: null });
			} catch (error) {
				if (revision === this.revision) {
					this.actionFailure = errorMessage(error);
					this.update({ action: null, error: this.actionFailure });
				}
			} finally {
				if (this.stopping === operation) this.stopping = null;
			}
		});
		this.stopping = operation;
		return operation;
	};
}

const controllers = new WeakMap<SandboxRuntimePort, DesktopSandboxController>();
export const desktopSandboxController = (
	runtime: SandboxRuntimePort,
): DesktopSandboxController => {
	let controller = controllers.get(runtime);
	if (!controller) {
		controller = new DesktopSandboxController(runtime);
		controllers.set(runtime, controller);
	}
	return controller;
};

export const desktopSandboxLabel = ({
	status,
	action,
	error,
}: DesktopSandboxState): string =>
	action === "stopping" || status?.state === "stopping"
		? "Stopping…"
		: action === "starting" || status?.state === "starting"
			? "Starting…"
			: error || status?.failure || status?.state === "unavailable"
				? "Error"
				: !status
					? "Checking…"
					: status.ready
						? "Ready"
						: "Stopped";
