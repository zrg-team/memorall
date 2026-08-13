import { describe, expect, it, vi } from "vitest";
import { createPGliteDataEntry } from "../pglite-export";

describe("PGlite portable export adapter", () => {
	it("reuses dumpDataDir with gzip and the canonical database entry path", async () => {
		const dumpDataDir = vi.fn(async () => new Blob(["pglite-data"]));
		const entry = await createPGliteDataEntry({ dumpDataDir });
		expect(dumpDataDir).toHaveBeenCalledWith("gzip");
		expect(entry.path).toBe("database/pglite.tar.gz");
		expect(new TextDecoder().decode(entry.bytes)).toBe("pglite-data");
	});
});
