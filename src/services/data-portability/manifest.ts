import {
	MEMORALL_EXPORT_FORMAT,
	MEMORALL_EXPORT_FORMAT_VERSION,
	type MemorallExportManifest,
} from "./types";

const environments = new Set(["extension", "web", "desktop"]);

export function normalizeArchivePath(path: string): string {
	if (
		!path ||
		path.includes("\0") ||
		path.startsWith("/") ||
		path.startsWith("\\")
	) {
		throw new Error(`Invalid archive path: ${path}`);
	}
	const normalized = path.replaceAll("\\", "/");
	const segments = normalized.split("/");
	if (
		segments.some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(`Invalid archive path: ${path}`);
	}
	return segments.join("/");
}

export function parseMemorallExportManifest(
	value: unknown,
): MemorallExportManifest {
	if (!value || typeof value !== "object")
		throw new Error("Export manifest must be an object");
	const manifest = value as Partial<MemorallExportManifest>;
	if (manifest.format !== MEMORALL_EXPORT_FORMAT)
		throw new Error("Not a Memorall export");
	if (manifest.formatVersion !== MEMORALL_EXPORT_FORMAT_VERSION) {
		throw new Error(
			`Unsupported Memorall export version: ${String(manifest.formatVersion)}`,
		);
	}
	if (
		typeof manifest.appVersion !== "string" ||
		manifest.appVersion.length === 0
	) {
		throw new Error("Export appVersion is required");
	}
	if (
		!manifest.sourceEnvironment ||
		!environments.has(manifest.sourceEnvironment)
	) {
		throw new Error("Invalid export sourceEnvironment");
	}
	if (
		typeof manifest.exportedAt !== "string" ||
		Number.isNaN(Date.parse(manifest.exportedAt))
	) {
		throw new Error("Invalid export timestamp");
	}
	if (
		!Number.isSafeInteger(manifest.databaseSchemaVersion) ||
		manifest.databaseSchemaVersion! < 0
	) {
		throw new Error("Invalid database schema version");
	}
	if (typeof manifest.includesCredentials !== "boolean") {
		throw new Error("includesCredentials must be boolean");
	}
	if (!Array.isArray(manifest.entries))
		throw new Error("Export entries must be an array");

	const seen = new Set<string>();
	for (const entry of manifest.entries) {
		const path = normalizeArchivePath(entry.path);
		if (path === "manifest.json" || seen.has(path)) {
			throw new Error(`Duplicate or reserved export entry: ${path}`);
		}
		seen.add(path);
		if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
			throw new Error(`Invalid entry size: ${path}`);
		}
		if (!/^[a-f\d]{64}$/i.test(entry.sha256)) {
			throw new Error(`Invalid SHA-256 for: ${path}`);
		}
		if (!manifest.includesCredentials && /^credentials(?:\/|$)/.test(path)) {
			throw new Error("Export contains credentials but manifest excludes them");
		}
	}

	return manifest as MemorallExportManifest;
}
