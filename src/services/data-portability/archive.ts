import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseMemorallExportManifest, normalizeArchivePath } from "./manifest";
import {
	MEMORALL_EXPORT_FORMAT,
	MEMORALL_EXPORT_FORMAT_VERSION,
	type MemorallArchiveEntry,
	type MemorallExportManifest,
	type MemorallExportMetadata,
	type ParsedMemorallArchive,
} from "./types";

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

async function sha256(bytes: Uint8Array): Promise<string> {
	const copied = new Uint8Array(bytes.byteLength);
	copied.set(bytes);
	const digest = await crypto.subtle.digest("SHA-256", copied.buffer);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function createMemorallArchive(
	entries: Iterable<MemorallArchiveEntry>,
	metadata: MemorallExportMetadata,
): Promise<Uint8Array> {
	const files: Record<string, Uint8Array> = {};
	const manifestEntries: MemorallExportManifest["entries"] = [];

	for (const entry of entries) {
		const path = normalizeArchivePath(entry.path);
		if (path === "manifest.json" || path in files) {
			throw new Error(`Duplicate or reserved export entry: ${path}`);
		}
		if (!metadata.includesCredentials && /^credentials(?:\/|$)/.test(path)) {
			throw new Error("Credentials require an explicit credential export");
		}
		files[path] = entry.bytes;
		manifestEntries.push({
			path,
			size: entry.bytes.byteLength,
			sha256: await sha256(entry.bytes),
		});
	}

	manifestEntries.sort((left, right) => left.path.localeCompare(right.path));
	const manifest: MemorallExportManifest = {
		format: MEMORALL_EXPORT_FORMAT,
		formatVersion: MEMORALL_EXPORT_FORMAT_VERSION,
		appVersion: metadata.appVersion,
		sourceEnvironment: metadata.sourceEnvironment,
		exportedAt: metadata.exportedAt ?? new Date().toISOString(),
		databaseSchemaVersion: metadata.databaseSchemaVersion,
		entries: manifestEntries,
		includesCredentials: metadata.includesCredentials ?? false,
	};
	files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
	return zipSync(files, { level: 6 });
}

export async function parseMemorallArchive(
	archive: Uint8Array,
	options: { maxUncompressedBytes?: number } = {},
): Promise<ParsedMemorallArchive> {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(archive);
	} catch (error) {
		throw new Error(
			`Invalid Memorall ZIP: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const manifestBytes = files["manifest.json"];
	if (!manifestBytes)
		throw new Error("Memorall export is missing manifest.json");

	let decoded: unknown;
	try {
		decoded = JSON.parse(strFromU8(manifestBytes));
	} catch {
		throw new Error("Memorall export manifest is not valid JSON");
	}
	const manifest = parseMemorallExportManifest(decoded);
	const maxBytes =
		options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
	let totalBytes = 0;
	const entries = new Map<string, Uint8Array>();

	for (const expected of manifest.entries) {
		const bytes = files[expected.path];
		if (!bytes)
			throw new Error(`Memorall export is missing entry: ${expected.path}`);
		totalBytes += bytes.byteLength;
		if (totalBytes > maxBytes)
			throw new Error("Memorall export exceeds the uncompressed size limit");
		if (bytes.byteLength !== expected.size)
			throw new Error(`Size mismatch for: ${expected.path}`);
		if ((await sha256(bytes)) !== expected.sha256.toLowerCase()) {
			throw new Error(`Checksum mismatch for: ${expected.path}`);
		}
		entries.set(expected.path, bytes);
	}

	const declared = new Set([
		"manifest.json",
		...manifest.entries.map((entry) => entry.path),
	]);
	for (const path of Object.keys(files)) {
		const normalized = normalizeArchivePath(path);
		if (!declared.has(normalized))
			throw new Error(`Undeclared export entry: ${normalized}`);
	}

	return { manifest, entries };
}
