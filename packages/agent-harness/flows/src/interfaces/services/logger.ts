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
