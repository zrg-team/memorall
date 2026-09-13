import { describe, expect, it, vi } from "vitest";
import "../tools/fs/fs-read.js";
import { toolRegistry } from "../registries/tool-registry.js";
import type { IFlowFileSystem } from "../interfaces/services/filesystem.js";

/**
 * `fs_read` splits a whole file into numbered lines, so it has to hold all of
 * it at once — `offset` and `limit` trim the output, not the read. That is fine
 * for the library's own documents and dangerous for a mapped folder, which is
 * the user's real disk and can hold a multi-gigabyte video.
 */

const makeFs = (overrides: Partial<IFlowFileSystem>): IFlowFileSystem =>
	({
		stat: async () => ({
			size: 10,
			isFile: () => true,
			isDirectory: () => false,
		}),
		readFile: async () => new TextEncoder().encode("hello\nworld"),
		...overrides,
	}) as unknown as IFlowFileSystem;

const read = async (fs: IFlowFileSystem, file_path = "/a.txt") => {
	const tool = toolRegistry.get("fs_read")?.factory?.({ fs } as never, {});
	if (!tool) throw new Error("fs_read is not registered");
	return (
		tool as { execute: (input: Record<string, unknown>) => Promise<string> }
	).execute({ file_path });
};

describe("fs_read limits", () => {
	it("reads an ordinary file", async () => {
		expect(await read(makeFs({}))).toContain("hello");
	});

	it("refuses a file too large to hold in memory", async () => {
		const readFile = vi.fn();
		const fs = makeFs({
			stat: async () =>
				({
					size: 200 * 1024 * 1024,
					isFile: () => true,
					isDirectory: () => false,
				}) as never,
			readFile: readFile as never,
		});

		const result = await read(fs, "/Movies/clip.mp4");

		expect(result).toMatch(/over the .* limit/i);
		// The point is not the message — it is that the bytes were never pulled.
		expect(readFile).not.toHaveBeenCalled();
	});

	it("keeps the real reason a read failed", async () => {
		// Reporting "file not found" for a read-only or disconnected mapped
		// folder sends the agent looking for a path that does exist.
		const fs = makeFs({
			stat: async () => {
				throw new Error('The mapped folder "Archive" is not available');
			},
		});

		expect(await read(fs, "/Archive/a.txt")).toContain("is not available");
	});

	it("says so when the path is a directory", async () => {
		const fs = makeFs({
			stat: async () =>
				({ size: 0, isFile: () => false, isDirectory: () => true }) as never,
		});

		expect(await read(fs, "/folder")).toMatch(/is a directory/i);
	});
});
