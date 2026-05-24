export interface IFlowLogger {
	info(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
}

export const consoleFlowLogger: IFlowLogger = {
	info: (msg, ...args) => console.info(msg, ...args),
	error: (msg, ...args) => console.error(msg, ...args),
	warn: (msg, ...args) => console.warn(msg, ...args),
	debug: (msg, ...args) => console.debug(msg, ...args),
};

export const logInfo: IFlowLogger["info"] = (...args) =>
	consoleFlowLogger.info(args[0] as string, ...args.slice(1));
export const logError: IFlowLogger["error"] = (...args) =>
	consoleFlowLogger.error(args[0] as string, ...args.slice(1));
export const logWarn: IFlowLogger["warn"] = (...args) =>
	consoleFlowLogger.warn(args[0] as string, ...args.slice(1));
export const logDebug: IFlowLogger["debug"] = (...args) =>
	consoleFlowLogger.debug(args[0] as string, ...args.slice(1));
