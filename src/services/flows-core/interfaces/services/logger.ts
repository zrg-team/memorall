import { serviceRegistry } from "@/services/flows-core/registries/service-registry";

serviceRegistry.registerSchema("logger", {
	name: "Logger",
	config: { required: true, category: "core" },
	metadata: { description: "Flow logging service" },
});

export interface IFlowLogger {
	info(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
}

declare global {
	interface ServiceRegistry {
		logger: IFlowLogger;
	}
}
