import type { AppEnvironment } from "@/platform";

export const MEMORALL_EXPORT_FORMAT = "memorall-export" as const;
export const MEMORALL_EXPORT_FORMAT_VERSION = 1 as const;

export interface MemorallExportEntry {
	path: string;
	sha256: string;
	size: number;
}

export interface MemorallExportManifest {
	format: typeof MEMORALL_EXPORT_FORMAT;
	formatVersion: typeof MEMORALL_EXPORT_FORMAT_VERSION;
	appVersion: string;
	sourceEnvironment: AppEnvironment;
	exportedAt: string;
	databaseSchemaVersion: number;
	entries: MemorallExportEntry[];
	includesCredentials: boolean;
}

export interface MemorallExportMetadata {
	appVersion: string;
	sourceEnvironment: AppEnvironment;
	exportedAt?: string;
	databaseSchemaVersion: number;
	includesCredentials?: boolean;
}

export interface MemorallArchiveEntry {
	path: string;
	bytes: Uint8Array;
}

export interface ParsedMemorallArchive {
	manifest: MemorallExportManifest;
	entries: Map<string, Uint8Array>;
}
