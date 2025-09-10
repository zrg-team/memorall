export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	id: string;
	timestamp: number;
	level: LogLevel;
	message: string;
	data?: any;
	context?: string;
	source?: string;
}

export interface LogFilter {
	level?: LogLevel;
	startTime?: number;
	endTime?: number;
	context?: string;
	source?: string;
	limit?: number;
}

export interface PersistentLoggerConfig {
	maxEntries?: number;
	retentionDays?: number;
	enableConsoleOutput?: boolean;
	enableIndexedDB?: boolean;
}

export interface LogStorage {
	initialize(): Promise<void>;
	store(entry: LogEntry): Promise<void>;
	retrieve(filter?: LogFilter): Promise<LogEntry[]>;
	clear(olderThan?: number): Promise<void>;
	getStorageSize(): Promise<number>;
	isAvailable(): boolean;
}
