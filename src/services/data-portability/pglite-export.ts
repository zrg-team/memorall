import type { MemorallArchiveEntry } from "./types";

export interface PGliteDataDirectoryDumper {
	dumpDataDir(compression?: "auto" | "gzip" | "none"): Promise<Blob | File>;
}

export async function createPGliteDataEntry(
	database: PGliteDataDirectoryDumper,
): Promise<MemorallArchiveEntry> {
	const dump = await database.dumpDataDir("gzip");
	return {
		path: "database/pglite.tar.gz",
		bytes: new Uint8Array(await dump.arrayBuffer()),
	};
}
