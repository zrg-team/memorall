import chalk from "chalk";

const isDevelopment =
	typeof process !== "undefined" && process.env?.NODE_ENV === "development";
const log = isDevelopment ? console.log : undefined;
const debug = isDevelopment ? console.debug : undefined;
const warn = console.warn;
const error = console.error;

const logBase = (
	prefix: string,
	colorFunc: (...text: unknown[]) => string,
	logFunc: typeof log | typeof debug | typeof warn | typeof error,
	...args: unknown[]
) => {
	const [key, ...rest] = args;
	const isKeyString = typeof key === "string";
	const messageKey = isKeyString ? key : "";

	logFunc?.(
		`${colorFunc(`${prefix} ${messageKey}`)}}`,
		...[isKeyString ? undefined : key, ...(rest?.length ? rest : [])].filter(
			Boolean,
		),
	);
};

export const logInfo = (...args: unknown[]) => {
	logBase("🔵 INFO:", chalk.blueBright, log, ...args);
};

export const logError = (...args: unknown[]) => {
	logBase("🔴 ERROR:", chalk.redBright, error, ...args);
};

export const logWarn = (...args: unknown[]) => {
	logBase("🔶 WARN:", chalk.yellowBright, warn, ...args);
};

export const logDebug = (...args: unknown[]) => {
	logBase("⚪ DEBUG:", chalk.greenBright, debug, ...args);
};

export const logSilent = (...args: unknown[]) => {
	logBase("⚫ SILENT:", chalk.whiteBright, log, ...args);
};
