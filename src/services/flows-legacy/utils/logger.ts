import type { IFlowLogger } from "@/services/flows-legacy/interfaces/services/logger";

export type { IFlowLogger } from "@/services/flows-legacy/interfaces/services/logger";

const noop = (): void => {};

export const noopFlowLogger: IFlowLogger = {
	info: noop,
	error: noop,
	warn: noop,
	debug: noop,
};

let activeFlowLogger: IFlowLogger = noopFlowLogger;

export const setFlowLogger = (logger: IFlowLogger): void => {
	activeFlowLogger = logger;
};

export const getFlowLogger = (): IFlowLogger => activeFlowLogger;

export const logInfo: IFlowLogger["info"] = (...args) =>
	activeFlowLogger.info(args[0] as string, ...args.slice(1));
export const logError: IFlowLogger["error"] = (...args) =>
	activeFlowLogger.error(args[0] as string, ...args.slice(1));
export const logWarn: IFlowLogger["warn"] = (...args) =>
	activeFlowLogger.warn(args[0] as string, ...args.slice(1));
export const logDebug: IFlowLogger["debug"] = (...args) =>
	activeFlowLogger.debug(args[0] as string, ...args.slice(1));
