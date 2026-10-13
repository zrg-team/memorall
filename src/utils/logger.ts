import chalk from "chalk";
import {
	IndexedDBLogStorage,
	type LogEntry,
	type LogLevel,
} from "./indexeddb-storage";
import { MAX_LOG_STORED, SHOW_LOG } from "@/constants/log";

interface LoggerConfig {
	maxEntries: number;
	enableConsoleOutput: boolean;
	enablePersistence: boolean;
}

// Trimming is amortised: a write only pays for it once every
// TRIM_INTERVAL entries, and the store is allowed to run that far over
// `maxEntries` in between. Trimming on every write made each log line cost a
// full scan of the store.
const TRIM_INTERVAL = 100;

// Persisted entries are diagnostic, not an archive. A single fat payload (a
// finished chat result, a tool output, a base64 attachment) used to be stored
// twice — once stringified into `message`, once structured-cloned into `data` —
// and every later trim read it back again.
const MAX_PERSISTED_MESSAGE_LENGTH = 2_000;

/**
 * Whether log entries are written to IndexedDB, for the Logs page. Off unless
 * someone turns it on there: writing every line cost a transaction per line in
 * every context. Kept in `chrome.storage.local` (`localStorage` outside the
 * extension) so every context follows the same choice.
 */
export const LOG_RECORDING_STORAGE_KEY = "memorall.logs.recording";

// The database older versions also wrote from content scripts.
const LEGACY_PAGE_LOG_DATABASE = "MemorallLogs";

const safeStringify = (value: unknown): string => {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
};

const extensionStorage = (): chrome.storage.StorageArea | null => {
	try {
		return typeof chrome !== "undefined" && chrome.storage?.local
			? chrome.storage.local
			: null;
	} catch {
		return null;
	}
};

/**
 * A content script runs on the visited site's origin: its IndexedDB belongs to
 * the site, which can read anything written there.
 */
const isContentScript = (): boolean => {
	try {
		if (typeof chrome === "undefined" || !chrome.runtime?.id) return false;
		// Protocol and host, not `origin`: URL reports "null" as the origin of
		// an extension URL outside the browser.
		const extension = new URL(chrome.runtime.getURL(""));
		const here = globalThis.location;
		return (
			!here ||
			here.protocol !== extension.protocol ||
			here.host !== extension.host
		);
	} catch {
		return false;
	}
};

const readRecordingSetting = async (): Promise<boolean> => {
	const storage = extensionStorage();
	if (storage) {
		const stored = await storage.get(LOG_RECORDING_STORAGE_KEY);
		return stored[LOG_RECORDING_STORAGE_KEY] === true;
	}
	try {
		return globalThis.localStorage?.getItem(LOG_RECORDING_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
};

const writeRecordingSetting = async (enabled: boolean): Promise<void> => {
	const storage = extensionStorage();
	if (storage) {
		await storage.set({ [LOG_RECORDING_STORAGE_KEY]: enabled });
		return;
	}
	try {
		globalThis.localStorage?.setItem(
			LOG_RECORDING_STORAGE_KEY,
			enabled ? "1" : "0",
		);
	} catch {
		// No storage here: the choice lasts for this context only.
	}
};

const onRecordingSettingChanged = (
	listener: (enabled: boolean) => void,
): void => {
	try {
		if (extensionStorage()) {
			chrome.storage.onChanged.addListener((changes, areaName) => {
				const change = changes[LOG_RECORDING_STORAGE_KEY];
				if (areaName === "local" && change) listener(change.newValue === true);
			});
			return;
		}
		globalThis.addEventListener?.("storage", (event: StorageEvent) => {
			if (event.key === LOG_RECORDING_STORAGE_KEY) {
				listener(event.newValue === "1");
			}
		});
	} catch {
		// Without change events the setting applies from the next start.
	}
};

class Logger {
	private storage: IndexedDBLogStorage;
	private config: LoggerConfig;
	private isShowLog: boolean;
	private writesSinceTrim = 0;
	private trimming: Promise<void> | null = null;
	private readonly inContentScript: boolean;
	private recordingSettingLoaded: Promise<void> = Promise.resolve();

	constructor(config: Partial<LoggerConfig> = {}) {
		this.inContentScript = isContentScript();
		this.config = {
			maxEntries: MAX_LOG_STORED,
			enableConsoleOutput: true,
			enablePersistence: false,
			...config,
		};

		this.isShowLog = SHOW_LOG;

		this.storage = new IndexedDBLogStorage();

		if (this.inContentScript) {
			this.config.enablePersistence = false;
			removeLegacyPageLogDatabase();
			return;
		}

		if (config.enablePersistence === undefined) {
			this.followRecordingSetting();
		} else if (this.config.enablePersistence && this.storage.isAvailable()) {
			this.initializeStorage();
		}
	}

	private followRecordingSetting(): void {
		onRecordingSettingChanged((enabled) => this.applyRecording(enabled));
		this.recordingSettingLoaded = readRecordingSetting()
			.then((enabled) => this.applyRecording(enabled))
			.catch(() => undefined);
	}

	private applyRecording(enabled: boolean): void {
		const wasEnabled = this.config.enablePersistence;
		this.config.enablePersistence = enabled;
		if (enabled && !wasEnabled && this.storage.isAvailable()) {
			this.initializeStorage();
		}
	}

	/** Whether this context writes log entries for the Logs page. */
	async isRecording(): Promise<boolean> {
		await this.recordingSettingLoaded;
		return this.config.enablePersistence;
	}

	/** Turn recording on or off in every context. */
	async setRecording(enabled: boolean): Promise<void> {
		if (this.inContentScript) return;
		this.applyRecording(enabled);
		await writeRecordingSetting(enabled);
	}

	/** Recorded logs can be read even while recording is off. */
	private canReadStorage(): boolean {
		return !this.inContentScript && this.storage.isAvailable();
	}

	private async initializeStorage(): Promise<void> {
		try {
			await this.storage.initialize();
			await this.cleanupOldLogs();
		} catch (error) {
			console.warn("Failed to initialize log storage:", error);
		}
	}

	private async cleanupOldLogs(): Promise<void> {
		try {
			await this.storage.trimToNewest(this.config.maxEntries);
		} catch (error) {
			console.warn("Failed to cleanup old logs:", error);
		}
	}

	/**
	 * Trim at most once per TRIM_INTERVAL writes, and never concurrently.
	 * Callers do not wait for it: a log line must not sit behind an IndexedDB
	 * sweep, which is what made every awaited `logger.info` on the chat path a
	 * full scan of the log store.
	 */
	private scheduleCleanup(): void {
		this.writesSinceTrim += 1;
		if (this.writesSinceTrim < TRIM_INTERVAL || this.trimming) {
			return;
		}
		this.writesSinceTrim = 0;
		this.trimming = this.cleanupOldLogs().finally(() => {
			this.trimming = null;
		});
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Sanitize data to remove non-serializable objects (Promises, Functions, etc.)
	 */
	private sanitizeData(data: any): any {
		if (data === null || data === undefined) {
			return data;
		}

		// Handle primitives
		if (typeof data !== "object") {
			return data;
		}

		// Handle Promise
		if (data instanceof Promise) {
			return "[Promise]";
		}

		// Handle Function
		if (typeof data === "function") {
			return "[Function]";
		}

		// Handle Arrays
		if (Array.isArray(data)) {
			return data.map((item) => this.sanitizeData(item));
		}

		// Handle Objects
		try {
			const sanitized: any = {};
			for (const key in data) {
				if (Object.hasOwn(data, key)) {
					const value = data[key];
					// Skip promises and functions
					if (value instanceof Promise) {
						sanitized[key] = "[Promise]";
					} else if (typeof value === "function") {
						sanitized[key] = "[Function]";
					} else if (typeof value === "object" && value !== null) {
						sanitized[key] = this.sanitizeData(value);
					} else {
						sanitized[key] = value;
					}
				}
			}
			return sanitized;
		} catch {
			return "[Circular or Complex Object]";
		}
	}

	private async persistLog(
		level: LogLevel,
		message: string,
		data?: any,
		context?: string,
		source?: string,
	): Promise<void> {
		if (!this.config.enablePersistence || !this.storage.isAvailable()) {
			return;
		}

		try {
			const entry: LogEntry = {
				id: this.generateId(),
				timestamp: Date.now(),
				level,
				message,
				data: this.sanitizeData(data),
				context,
				source,
			};

			await this.storage.store(entry);

			// Amortised: see scheduleCleanup.
			this.scheduleCleanup();
		} catch (error) {
			console.warn("Failed to persist log:", error);
		}
	}

	private logToConsole(
		prefix: string,
		colorFunc: (...text: unknown[]) => string,
		logFunc:
			| typeof console.log
			| typeof console.debug
			| typeof console.warn
			| typeof console.error
			| undefined,
		...args: unknown[]
	): void {
		if (!this.config.enableConsoleOutput || !logFunc) {
			return;
		}

		const [key, ...rest] = args;
		const isKeyString = typeof key === "string";
		const messageKey = isKeyString ? key : "";

		// Use bound console method to preserve source map locations
		const boundLog = logFunc.bind(console);
		boundLog(
			`${colorFunc(`${prefix} ${messageKey}`)}`,
			...[isKeyString ? undefined : key, ...(rest?.length ? rest : [])].filter(
				Boolean,
			),
		);
	}

	private async log(
		level: LogLevel,
		prefix: string,
		colorFunc: (...text: unknown[]) => string,
		logFunc:
			| typeof console.log
			| typeof console.debug
			| typeof console.warn
			| typeof console.error
			| undefined,
		context?: string,
		source?: string,
		...args: unknown[]
	): Promise<void> {
		// Console output
		if (this.isShowLog) {
			this.logToConsole(prefix, colorFunc, logFunc, ...args);
		}

		// Persistence.
		// Only string arguments form the message; the rest already travel in
		// `data`, and stringifying them here stored every payload twice.
		const textArgs = args.filter(
			(arg): arg is string => typeof arg === "string",
		);
		const message = (
			textArgs.length > 0 ? textArgs.join(" ") : safeStringify(args[0])
		).slice(0, MAX_PERSISTED_MESSAGE_LENGTH);

		const data = args.length > 1 ? args.slice(1) : undefined;

		await this.persistLog(level, message, data, context, source);
	}

	async info(
		context?: string,
		source?: string,
		...args: unknown[]
	): Promise<void> {
		await this.log(
			"info",
			"🔵 INFO:",
			chalk.blueBright,
			this.isShowLog ? console.log : undefined,
			context,
			source,
			...args,
		);
	}

	async error(
		context?: string,
		source?: string,
		...args: unknown[]
	): Promise<void> {
		await this.log(
			"error",
			"🔴 ERROR:",
			chalk.redBright,
			console.error,
			context,
			source,
			...args,
		);
	}

	async warn(
		context?: string,
		source?: string,
		...args: unknown[]
	): Promise<void> {
		await this.log(
			"warn",
			"🔶 WARN:",
			chalk.yellowBright,
			this.isShowLog ? console.warn : undefined,
			context,
			source,
			...args,
		);
	}

	async debug(
		context?: string,
		source?: string,
		...args: unknown[]
	): Promise<void> {
		await this.log(
			"debug",
			"⚪ DEBUG:",
			chalk.greenBright,
			this.isShowLog ? console.debug : undefined,
			context,
			source,
			...args,
		);
	}

	// Retrieve logs from storage
	async getLogs(filter?: {
		level?: LogLevel;
		startTime?: number;
		endTime?: number;
		context?: string;
		source?: string;
		limit?: number;
	}): Promise<LogEntry[]> {
		if (!this.canReadStorage()) {
			return [];
		}

		try {
			return await this.storage.retrieve(filter);
		} catch (error) {
			console.warn("Failed to retrieve logs:", error);
			return [];
		}
	}

	// Clear all logs
	async clearLogs(): Promise<void> {
		if (!this.canReadStorage()) {
			return;
		}

		try {
			await this.storage.clear();
		} catch (error) {
			console.warn("Failed to clear logs:", error);
		}
	}

	// Get total log count
	async getLogCount(): Promise<number> {
		if (!this.canReadStorage()) {
			return 0;
		}

		try {
			return await this.storage.getStorageSize();
		} catch (error) {
			console.warn("Failed to get log count:", error);
			return 0;
		}
	}

	// Export logs as JSON string
	async exportLogs(filter?: {
		level?: LogLevel;
		startTime?: number;
		endTime?: number;
		context?: string;
		source?: string;
		limit?: number;
	}): Promise<string> {
		if (!this.canReadStorage()) {
			return JSON.stringify([]);
		}

		try {
			const logs = await this.storage.retrieve(filter);
			const exportData = {
				exportedAt: new Date().toISOString(),
				totalLogs: logs.length,
				filter: filter || {},
				logs: logs,
			};
			return JSON.stringify(exportData, null, 2);
		} catch (error) {
			console.warn("Failed to export logs:", error);
			return JSON.stringify({ error: "Failed to export logs" });
		}
	}

	// Get current configuration
	getConfig(): LoggerConfig {
		return { ...this.config };
	}

	// Update configuration
	updateConfig(newConfig: Partial<LoggerConfig>): void {
		const { enablePersistence, ...rest } = newConfig;
		this.config = { ...this.config, ...rest };
		if (enablePersistence !== undefined && !this.inContentScript) {
			this.applyRecording(enablePersistence);
		}
	}
}

/**
 * Older versions logged from content scripts into the site's own IndexedDB,
 * where the site could read it. Remove what they left, once per page.
 */
function removeLegacyPageLogDatabase(): void {
	try {
		const factory = globalThis.indexedDB;
		if (!factory?.databases) return;
		void factory
			.databases()
			.then((databases) => {
				if (databases.some((db) => db.name === LEGACY_PAGE_LOG_DATABASE)) {
					factory.deleteDatabase(LEGACY_PAGE_LOG_DATABASE);
				}
			})
			.catch(() => undefined);
	} catch {
		// IndexedDB unavailable on this page.
	}
}

// Create singleton logger instance
const logger = new Logger();

// Helper to format log output
function formatLogArgs(
	prefix: string,
	colorFunc: (...text: unknown[]) => string,
	args: unknown[],
): unknown[] {
	const [key, ...rest] = args;
	const isKeyString = typeof key === "string";
	const messageKey = isKeyString ? key : "";

	return [
		`${colorFunc(`${prefix} ${messageKey}`)}`,
		...[isKeyString ? undefined : key, ...(rest?.length ? rest : [])].filter(
			Boolean,
		),
	];
}

// Export convenience functions that call console directly to preserve source maps
export const logInfo = (...args: unknown[]) => {
	// Persist asynchronously without blocking
	logger.info(undefined, undefined, ...args);
};

export const logError = (...args: unknown[]) => {
	// Persist asynchronously without blocking
	logger.error(undefined, undefined, ...args);
};

export const logWarn = (...args: unknown[]) => {
	// Persist asynchronously without blocking
	logger.warn(undefined, undefined, ...args);
};

export const logDebug = (...args: unknown[]) => {
	// Persist asynchronously without blocking
	logger.debug(undefined, undefined, ...args);
};

// Keep logSilent for backward compatibility (maps to info level)
export const logSilent = (...args: unknown[]) => {
	// Persist asynchronously without blocking
	logger.info(undefined, undefined, ...args);
};

// Export types for external use
export type { LogEntry, LoggerConfig, LogLevel };
// Export logger instance for advanced usage
export { logger };
