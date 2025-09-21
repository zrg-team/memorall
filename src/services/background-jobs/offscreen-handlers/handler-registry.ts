import type { ProcessHandler, BaseJob } from "./types";

export interface HandlerRegistration {
	instance: ProcessHandler<BaseJob>;
	jobs: string[];
}

export class HandlerRegistry {
	private static instance: HandlerRegistry;
	private handlers = new Map<string, ProcessHandler<BaseJob>>();

	private constructor() {}

	static getInstance(): HandlerRegistry {
		if (!HandlerRegistry.instance) {
			HandlerRegistry.instance = new HandlerRegistry();
		}
		return HandlerRegistry.instance;
	}

	register(registration: HandlerRegistration): void {
		for (const jobType of registration.jobs) {
			this.handlers.set(jobType, registration.instance);
		}
	}

	getHandler(jobType: string): ProcessHandler<BaseJob> {
		const handler = this.handlers.get(jobType);
		if (!handler) {
			throw new Error(`No handler registered for job type: ${jobType}`);
		}
		return handler;
	}

	getRegisteredJobTypes(): string[] {
		return Array.from(this.handlers.keys());
	}
}

export const handlerRegistry = HandlerRegistry.getInstance();