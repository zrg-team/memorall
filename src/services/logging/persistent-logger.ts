import type {
	LogEntry,
	LogFilter,
	LogLevel,
	PersistentLoggerConfig,
	LogStorage,
} from "./types";
import { IndexedDBLogStorage } from "./indexeddb-storage";
import { logDebug, logError, logInfo, logWarn } from "@/utils/logger";

export class PersistentLogger {
	private storage: LogStorage;
	private config: Required<PersistentLoggerConfig>;
	private initialized = false;

	constructor(config: PersistentLoggerConfig = {}) {
		this.config = {
			maxEntries: config.maxEntries ?? 10000,
			retentionDays: config.retentionDays ?? 7,
			enableConsoleOutput: config.enableConsoleOutput ?? true,
			enableIndexedDB: config.enableIndexedDB ?? true,
		};

		this.storage = new IndexedDBLogStorage();
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			if (this.config.enableIndexedDB && this.storage.isAvailable()) {
				await this.storage.initialize();
				this.log(
					"info",
					"PersistentLogger initialized with IndexedDB storage",
					{ storage: "IndexedDB" },
				);
			} else {
				this.log(
					"warn",
					"IndexedDB not available, falling back to console-only logging",
				);
			}

			await this.cleanup();
			this.initialized = true;
		} catch (error) {
			this.log("error", "Failed to initialize PersistentLogger", { error });
			throw error;
		}
	}

	debug(message: string, data?: any, context?: string): void {
		this.log("debug", message, data, context);
	}

	info(message: string, data?: any, context?: string): void {
		this.log("info", message, data, context);
	}

	warn(message: string, data?: any, context?: string): void {
		this.log("warn", message, data, context);
	}

	error(message: string, data?: any, context?: string): void {
		logError(message, data, context);
		this.log("error", message, data, context);
	}

	private async log(
		level: LogLevel,
		message: string,
		data?: any,
		context?: string,
	): Promise<void> {
		const entry: LogEntry = {
			id: this.generateId(),
			timestamp: Date.now(),
			level,
			message,
			data,
			context,
			source: this.getSource(),
		};

		if (this.config.enableConsoleOutput) {
			this.logToConsole(entry);
		}

		if (this.initialized && this.storage.isAvailable()) {
			try {
				await this.storage.store(entry);
			} catch (error) {
				logWarn("Failed to store log entry:", error);
			}
		} else {
			logWarn(
				"PersistentLogger is not initialized or IndexedDB is not available",
			);
		}
	}

	async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
		if (!this.initialized || !this.storage.isAvailable()) {
			return [];
		}

		try {
			return await this.storage.retrieve(filter);
		} catch (error) {
			logWarn("Failed to retrieve logs:", error);
			return [];
		}
	}

	async clearLogs(olderThan?: number): Promise<void> {
		if (!this.initialized || !this.storage.isAvailable()) {
			return;
		}

		try {
			await this.storage.clear(olderThan);
			this.log("info", "Logs cleared", { olderThan });
		} catch (error) {
			this.log("error", "Failed to clear logs", { error });
		}
	}

	async getLogCount(): Promise<number> {
		if (!this.initialized || !this.storage.isAvailable()) {
			return 0;
		}

		try {
			return await this.storage.getStorageSize();
		} catch (error) {
			logWarn("Failed to get log count:", error);
			return 0;
		}
	}

	async exportLogs(filter?: LogFilter): Promise<string> {
		const logs = await this.getLogs(filter);
		return JSON.stringify(logs, null, 2);
	}

	private async cleanup(): Promise<void> {
		if (!this.storage.isAvailable()) return;

		try {
			const retentionCutoff =
				Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
			await this.storage.clear(retentionCutoff);

			const currentCount = await this.storage.getStorageSize();
			if (currentCount > this.config.maxEntries) {
				const logs = await this.storage.retrieve({ limit: currentCount });
				const toDelete = currentCount - this.config.maxEntries;

				logs.sort((a, b) => a.timestamp - b.timestamp);
				const oldestLogs = logs.slice(0, toDelete);

				if (oldestLogs.length > 0) {
					const oldestTimestamp = oldestLogs[oldestLogs.length - 1].timestamp;
					await this.storage.clear(oldestTimestamp);
				}
			}
		} catch (error) {
			logWarn("Failed to cleanup old logs:", error);
		}
	}

	private logToConsole(entry: LogEntry): void {
		const timestamp = new Date(entry.timestamp).toISOString();
		const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;
		const contextStr = entry.context ? ` [${entry.context}]` : "";
		const fullMessage = `${prefix}${contextStr} ${entry.message}`;

		switch (entry.level) {
			case "debug":
				logDebug(fullMessage, entry.data);
				break;
			case "info":
				logInfo(fullMessage, entry.data);
				break;
			case "warn":
				logWarn(fullMessage, entry.data);
				break;
			case "error":
				logError(fullMessage, entry.data);
				break;
		}
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	private getSource(): string {
		try {
			const error = new Error();
			const stack = error.stack?.split("\n");
			if (stack && stack.length > 4) {
				const caller = stack[4];
				const match = caller.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
				if (match) {
					const [, functionName, file, line] = match;
					const fileName = file.split("/").pop() || file;
					return `${fileName}:${line}${functionName !== "Object.<anonymous>" ? ` (${functionName})` : ""}`;
				}
			}
		} catch {
			// Ignore errors in source detection
		}
		return "unknown";
	}
}

export const persistentLogger = new PersistentLogger();
