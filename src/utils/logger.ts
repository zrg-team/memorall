import chalk from "chalk";
import {
	IndexedDBLogStorage,
	type LogEntry,
	type LogLevel,
} from "./indexeddb-storage";

interface LoggerConfig {
	maxEntries: number;
	enableConsoleOutput: boolean;
	enablePersistence: boolean;
}

class Logger {
	private storage: IndexedDBLogStorage;
	private config: LoggerConfig;
	private isDevelopment: boolean;

	constructor(config: Partial<LoggerConfig> = {}) {
		this.config = {
			maxEntries: 200,
			enableConsoleOutput: true,
			enablePersistence: true,
			...config,
		};

		this.isDevelopment =
			typeof process !== "undefined" && process.env?.NODE_ENV === "development";

		this.storage = new IndexedDBLogStorage();

		// Initialize storage if persistence is enabled
		if (this.config.enablePersistence) {
			this.initializeStorage();
		}
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
			const count = await this.storage.getStorageSize();
			if (count > this.config.maxEntries) {
				// Get all logs, sort by timestamp, and remove oldest ones
				const logs = await this.storage.retrieve();
				logs.sort((a, b) => b.timestamp - a.timestamp);

				// Keep only the newest maxEntries logs
				const logsToKeep = logs.slice(0, this.config.maxEntries);
				const oldestToKeep = logsToKeep[logsToKeep.length - 1];

				if (oldestToKeep) {
					// Clear logs older than the oldest we want to keep
					await this.storage.clear(oldestToKeep.timestamp - 1);
				}
			}
		} catch (error) {
			console.warn("Failed to cleanup old logs:", error);
		}
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
				data,
				context,
				source,
			};

			await this.storage.store(entry);

			// Cleanup after storing new log
			await this.cleanupOldLogs();
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

		logFunc(
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
		this.logToConsole(prefix, colorFunc, logFunc, ...args);

		// Persistence
		const message = args
			.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
			.join(" ");

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
			this.isDevelopment ? console.log : undefined,
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
			console.warn,
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
			this.isDevelopment ? console.debug : undefined,
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
		if (!this.config.enablePersistence || !this.storage.isAvailable()) {
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
		if (!this.config.enablePersistence || !this.storage.isAvailable()) {
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
		if (!this.config.enablePersistence || !this.storage.isAvailable()) {
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
		if (!this.config.enablePersistence || !this.storage.isAvailable()) {
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
		this.config = { ...this.config, ...newConfig };

		// Reinitialize storage if persistence settings changed
		if (newConfig.enablePersistence !== undefined) {
			if (this.config.enablePersistence) {
				this.initializeStorage();
			}
		}
	}
}

// Create singleton logger instance
const logger = new Logger();

// Export convenience functions that maintain backward compatibility
export const logInfo = (...args: unknown[]) =>
	logger.info(undefined, undefined, ...args);
export const logError = (...args: unknown[]) =>
	logger.error(undefined, undefined, ...args);
export const logWarn = (...args: unknown[]) =>
	logger.warn(undefined, undefined, ...args);
export const logDebug = (...args: unknown[]) =>
	logger.debug(undefined, undefined, ...args);

// Keep logSilent for backward compatibility (maps to info level)
export const logSilent = (...args: unknown[]) =>
	logger.info(undefined, undefined, ...args);

// Export logger instance for advanced usage
export { logger };

// Export types for external use
export type { LogLevel, LogEntry, LoggerConfig };
