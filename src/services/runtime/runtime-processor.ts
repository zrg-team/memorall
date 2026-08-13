import type { IJobNotificationBridge } from "@/services/background-jobs/bridges";
import type { BaseJob } from "@/services/background-jobs/handlers/types";

export type RuntimeProcessorState =
	| "idle"
	| "starting"
	| "running"
	| "stopping"
	| "stopped"
	| "failed";

export interface RuntimeProcessorLogger {
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	error(message: string, error?: unknown): void;
}

export interface RuntimeProcessorDependencies {
	notifications: IJobNotificationBridge;
	listPendingJobs(): Promise<BaseJob[]>;
	executeJob(job: BaseJob, signal: AbortSignal): Promise<void>;
	safetyIntervalMs?: number;
	logger?: RuntimeProcessorLogger;
}

const noopLogger: RuntimeProcessorLogger = {
	debug: () => undefined,
	info: () => undefined,
	error: () => undefined,
};

export class RuntimeProcessor {
	private state: RuntimeProcessorState = "idle";
	private readonly controller = new AbortController();
	private readonly inFlight = new Set<string>();
	private readonly processed = new Set<string>();
	private readonly unsubscribers: Array<() => void> = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private draining: Promise<void> | null = null;
	private drainRequested = false;
	private readonly logger: RuntimeProcessorLogger;

	constructor(private readonly dependencies: RuntimeProcessorDependencies) {
		this.logger = dependencies.logger ?? noopLogger;
	}

	getState(): RuntimeProcessorState {
		return this.state;
	}

	async start(): Promise<void> {
		if (this.state === "running") return;
		if (this.state !== "idle") {
			throw new Error(`RuntimeProcessor cannot start from state ${this.state}`);
		}
		this.state = "starting";
		try {
			this.unsubscribers.push(
				this.dependencies.notifications.subscribe("JOB_ENQUEUED", (message) => {
					if (message.job?.status === "pending") void this.execute(message.job);
				}),
				this.dependencies.notifications.subscribe("JOB_UPDATED", (message) => {
					if (!message.job || message.job.status === "pending")
						void this.drain();
				}),
			);

			const interval = this.dependencies.safetyIntervalMs ?? 120_000;
			if (interval > 0)
				this.timer = setInterval(() => void this.drain(), interval);
			this.state = "running";
			await this.drain();
			this.logger.info("RuntimeProcessor started");
		} catch (error) {
			this.state = "failed";
			await this.stopInternal();
			throw error;
		}
	}

	async drain(): Promise<void> {
		if (this.state !== "running" && this.state !== "starting") return;
		if (this.draining) {
			this.drainRequested = true;
			return this.draining;
		}

		this.draining = (async () => {
			do {
				this.drainRequested = false;
				const jobs = await this.dependencies.listPendingJobs();
				for (const job of jobs) {
					if (this.controller.signal.aborted) return;
					if (job.status === "pending") await this.execute(job);
				}
			} while (this.drainRequested && !this.controller.signal.aborted);
		})().finally(() => {
			this.draining = null;
		});
		return this.draining;
	}

	async stop(): Promise<void> {
		if (this.state === "stopped") return;
		this.state = "stopping";
		this.controller.abort();
		await this.stopInternal();
		this.state = "stopped";
		this.logger.info("RuntimeProcessor stopped");
	}

	private async execute(job: BaseJob): Promise<void> {
		if (
			this.controller.signal.aborted ||
			this.inFlight.has(job.id) ||
			this.processed.has(job.id)
		) {
			return;
		}
		this.inFlight.add(job.id);
		try {
			await this.dependencies.executeJob(job, this.controller.signal);
			this.processed.add(job.id);
		} catch (error) {
			if (!this.controller.signal.aborted) {
				this.logger.error(`Runtime job failed: ${job.id}`, error);
			}
		} finally {
			this.inFlight.delete(job.id);
		}
	}

	private async stopInternal(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
		try {
			await this.draining;
		} catch {
			// The original drain caller receives the failure.
		}
	}
}
