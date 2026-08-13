import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { createMemorallArchive, parseMemorallArchive } from "../archive";

const encoder = new TextEncoder();

describe(".memorall archive", () => {
	it("round-trips entries with a validated manifest", async () => {
		const bytes = await createMemorallArchive(
			[
				{ path: "database/pglite.tar.gz", bytes: encoder.encode("database") },
				{ path: "workspace/notes/hello.md", bytes: encoder.encode("hello") },
			],
			{
				appVersion: "0.5.1",
				sourceEnvironment: "extension",
				exportedAt: "2026-08-13T00:00:00.000Z",
				databaseSchemaVersion: 15,
			},
		);
		const parsed = await parseMemorallArchive(bytes);
		expect(parsed.manifest.includesCredentials).toBe(false);
		expect(
			new TextDecoder().decode(parsed.entries.get("workspace/notes/hello.md")),
		).toBe("hello");
	});

	it("excludes credentials unless explicitly requested", async () => {
		await expect(
			createMemorallArchive(
				[
					{
						path: "credentials/providers.bin",
						bytes: encoder.encode("secret"),
					},
				],
				{
					appVersion: "0.5.1",
					sourceEnvironment: "web",
					databaseSchemaVersion: 15,
				},
			),
		).rejects.toThrow("Credentials require");
	});

	it("rejects corrupted, undeclared, and oversized entries", async () => {
		const original = await createMemorallArchive(
			[{ path: "workspace/file.txt", bytes: encoder.encode("safe") }],
			{
				appVersion: "1",
				sourceEnvironment: "desktop",
				databaseSchemaVersion: 15,
			},
		);
		const files = unzipSync(original);
		files["workspace/file.txt"] = encoder.encode("tampered");
		await expect(parseMemorallArchive(zipSync(files))).rejects.toThrow(
			/Size mismatch|Checksum mismatch/,
		);

		const withExtra = unzipSync(original);
		withExtra["extra.txt"] = encoder.encode("extra");
		await expect(parseMemorallArchive(zipSync(withExtra))).rejects.toThrow(
			"Undeclared",
		);
		await expect(
			parseMemorallArchive(original, { maxUncompressedBytes: 1 }),
		).rejects.toThrow("size limit");
	});
});
