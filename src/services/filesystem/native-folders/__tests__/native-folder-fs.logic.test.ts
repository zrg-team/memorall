import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeFolderFileSystem } from "../native-folder-fs";
import type {
	NativeFilesystemEntry,
	NativeFilesystemPort,
} from "@/platform/contracts/core";

/**
 * The backend is driven against a fake port, so none of this needs Tauri.
 *
 * What is being pinned here is that a mapped folder behaves like any other part
 * of the virtual filesystem: the same errno codes, the same async-only surface,
 * and a listing that costs one native call rather than one per file.
 */

const entry = (
	name: string,
	over: Partial<NativeFilesystemEntry> = {},
): NativeFilesystemEntry => ({
	name,
	kind: "file",
	size: 3,
	mtimeMs: 1_000,
	birthtimeMs: 500,
	readOnly: false,
	...over,
});

const nativeFailure = (code: string, message = "nope") =>
	Object.assign(new Error(message), { code });

interface Fake extends NativeFilesystemPort {
	calls: Record<string, number>;
}

const fakePort = (over: Partial<NativeFilesystemPort> = {}): Fake => {
	const calls: Record<string, number> = {};
	const count =
		<T extends (...args: never[]) => unknown>(name: string, fn: T) =>
		(...args: Parameters<T>) => {
			calls[name] = (calls[name] ?? 0) + 1;
			return fn(...args);
		};
	const base: NativeFilesystemPort = {
		listRoots: async () => [],
		addRoot: async () => null,
		removeRoot: async () => {},
		list: async () => [entry("a.md"), entry("b.md")],
		stat: async () => entry("a.md"),
		read: async () => new TextEncoder().encode("hey"),
		write: async () => {},
		createFile: async () => entry("new.md"),
		mkdir: async () => entry("dir", { kind: "directory" }),
		unlink: async () => {},
		rmdir: async () => {},
		rename: async () => {},
		touch: async () => {},
		revision: async () => ({ entries: 2, maxMtimeMs: 1_000 }),
		watch: async () => () => {},
		...over,
	};
	const wrapped = Object.fromEntries(
		Object.entries(base).map(([key, value]) => [
			key,
			count(key, value as (...args: never[]) => unknown),
		]),
	) as unknown as NativeFilesystemPort;
	return Object.assign(wrapped, { calls });
};

const build = (port: NativeFilesystemPort) =>
	createNativeFolderFileSystem({ port, rootId: "root-1" });

describe("native folder backend", () => {
	let port: Fake;
	beforeEach(() => {
		port = fakePort();
	});

	it("lists a directory with one native call, and serves the stats from it", async () => {
		const fs = await build(port);
		const names = await fs.readdir("/");
		expect(names).toEqual(["a.md", "b.md"]);

		// The virtual filesystem stats each entry, and the document library stats
		// them again. Both must be served from the listing, or a 500-file folder
		// turns into a thousand round trips.
		await fs.stat("/a.md");
		await fs.stat("/b.md");
		expect(port.calls.list).toBe(1);
		expect(port.calls.stat ?? 0).toBe(0);
	});

	it("goes back to the native side once the cached metadata has expired", async () => {
		const fs = await createNativeFolderFileSystem({
			port,
			rootId: "root-1",
			cacheTtlMs: 0,
		});
		await fs.readdir("/");
		await fs.stat("/a.md");
		expect(port.calls.stat).toBe(1);
	});

	it("re-reads after a write rather than trusting the cached size", async () => {
		const fs = await build(port);
		await fs.readdir("/");
		await fs.write("/a.md", new TextEncoder().encode("longer"), 0);
		await fs.stat("/a.md");
		expect(port.calls.stat).toBe(1);
	});

	it("reports a directory as a directory", async () => {
		const fs = await build(
			fakePort({ stat: async () => entry("docs", { kind: "directory" }) }),
		);
		const inode = await fs.stat("/docs");
		// 0o040000 is the directory bit the virtual filesystem tests for.
		expect(inode.mode & 0o170000).toBe(0o040000);
	});

	it("marks a read-only file read-only", async () => {
		const fs = await build(
			fakePort({ stat: async () => entry("a.md", { readOnly: true }) }),
		);
		const inode = await fs.stat("/a.md");
		expect(inode.mode & 0o200).toBe(0);
	});

	it("translates a missing file into ENOENT so existing callers still work", async () => {
		// DocumentFileSystem.isNotFoundError branches on exactly this.
		const fs = await build(
			fakePort({
				stat: async () => {
					throw nativeFailure("NOT_FOUND", "no such file");
				},
			}),
		);
		await expect(fs.stat("/gone.md")).rejects.toMatchObject({
			code: "ENOENT",
			path: "/gone.md",
		});
	});

	it.each([
		["EXISTS", "EEXIST"],
		["NOT_EMPTY", "ENOTEMPTY"],
		["PERMISSION", "EACCES"],
		["OUT_OF_SCOPE", "EACCES"],
		["IS_DIR", "EISDIR"],
	])("translates %s into %s", async (native, errno) => {
		const fs = await build(
			fakePort({
				stat: async () => {
					throw nativeFailure(native);
				},
			}),
		);
		await expect(fs.stat("/x")).rejects.toMatchObject({ code: errno });
	});

	it("reads file bytes into the caller's buffer", async () => {
		const fs = await build(port);
		const buffer = new Uint8Array(3);
		await fs.read("/a.md", buffer, 0, 3);
		expect(new TextDecoder().decode(buffer)).toBe("hey");
	});

	it("passes writes straight through without truncating", async () => {
		const write = vi.fn(async () => {});
		const fs = await build(fakePort({ write }));
		const bytes = new TextEncoder().encode("hi");
		await fs.write("/a.md", bytes, 4);
		expect(write).toHaveBeenCalledWith("root-1", "a.md", 4, bytes, false);
	});

	it("addresses the port with a relative path, never the mount-absolute one", async () => {
		const stat = vi.fn(async () => entry("c.md"));
		const fs = await build(fakePort({ stat }));
		await fs.stat("/deep/nested/c.md");
		expect(stat).toHaveBeenCalledWith("root-1", "deep/nested/c.md");
	});

	it("refuses every synchronous operation", async () => {
		const fs = await build(port);
		// Nothing in the product calls these; a wrong synchronous answer would be
		// worse than an explicit refusal.
		expect(() => fs.statSync("/a.md")).toThrow(/async/i);
		expect(() => fs.readdirSync("/")).toThrow(/async/i);
		expect(() => fs.writeSync("/a.md", new Uint8Array(), 0)).toThrow(/async/i);
	});

	it("still allows an unmount, which calls syncSync", async () => {
		const fs = await build(port);
		expect(() => fs.syncSync()).not.toThrow();
	});
});
