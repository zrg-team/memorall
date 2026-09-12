import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeMountRoot } from "@/platform/contracts/core";

/**
 * The registry is what makes a mapped folder survive `refreshFsCache()`, which
 * rebuilds ZenFS from two static mounts and would otherwise drop every mapped
 * folder silently. That regression is the last test in this file.
 */

const mounts = new Map<string, unknown>();
const mkdir = vi.fn(async () => undefined);
const readdir = vi.fn(async (_path: string): Promise<string[]> => []);
const rmdir = vi.fn(async () => undefined);
const mount = vi.fn((path: string, fs: unknown) => {
	mounts.set(path, fs);
});
const umount = vi.fn((path: string) => {
	mounts.delete(path);
});

vi.mock("@zenfs/core", () => ({
	mounts,
	fs: { mount, umount, promises: { mkdir, readdir, rmdir } },
}));

vi.mock("../native-folder-fs", () => ({
	createNativeFolderFileSystem: vi.fn(async () => ({ marker: "native-fs" })),
}));

const listRoots = vi.fn<() => Promise<NativeMountRoot[]>>(async () => []);

vi.mock("@/platform/current", () => ({
	platform: {
		get nativeFilesystem() {
			return nativeFilesystem;
		},
	},
}));

let nativeFilesystem: { listRoots: typeof listRoots } | undefined;

const root = (over: Partial<NativeMountRoot> = {}): NativeMountRoot => ({
	id: "root-1",
	label: "Notes",
	displayPath: "C:/Users/me/Notes",
	readOnly: false,
	available: true,
	...over,
});

const load = async () => {
	const module = await import("../mount-registry");
	module.resetNativeFolderMountsForTest();
	return module;
};

beforeEach(() => {
	vi.clearAllMocks();
	mounts.clear();
	nativeFilesystem = { listRoots };
	listRoots.mockResolvedValue([]);
});

describe("native folder mount registry", () => {
	it("does nothing at all on a platform with no native filesystem", async () => {
		nativeFilesystem = undefined;
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		// Extension and web must be untouched by this feature — not merely
		// harmless, but never even reaching the ZenFS layer.
		expect(mount).not.toHaveBeenCalled();
		expect(mkdir).not.toHaveBeenCalled();
	});

	it("mounts a mapped folder at the top level of the library", async () => {
		listRoots.mockResolvedValue([root()]);
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		expect(mount).toHaveBeenCalledWith("/home/files/Notes", {
			marker: "native-fs",
		});
	});

	it("creates the mount point first, because ZenFS will not invent one", async () => {
		// A mount whose directory does not exist in the parent filesystem works
		// but never shows up in the tree, which looks like the feature silently
		// failing.
		listRoots.mockResolvedValue([root()]);
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		expect(mkdir).toHaveBeenCalledWith("/home/files/Notes", {
			recursive: true,
		});
	});

	it("is idempotent, so repeated syncs do not churn the mount", async () => {
		listRoots.mockResolvedValue([root()]);
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		await syncNativeFolderMounts();
		expect(mount).toHaveBeenCalledTimes(1);
	});

	it("unmounts a folder the user has unmapped", async () => {
		listRoots.mockResolvedValue([root()]);
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();

		listRoots.mockResolvedValue([]);
		await syncNativeFolderMounts();
		expect(umount).toHaveBeenCalledWith("/home/files/Notes");
	});

	it("keeps going when one folder fails to mount", async () => {
		listRoots.mockResolvedValue([
			root({ id: "bad", label: "Broken" }),
			root({ id: "good", label: "Fine" }),
		]);
		mkdir.mockRejectedValueOnce(new Error("gone"));
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		expect(mount).toHaveBeenCalledWith("/home/files/Fine", expect.anything());
	});

	it("re-mounts after refreshFsCache has torn the tree down", async () => {
		listRoots.mockResolvedValue([root()]);
		const { syncNativeFolderMounts } = await load();
		await syncNativeFolderMounts();
		expect(mounts.has("/home/files/Notes")).toBe(true);

		// What refreshFsCache() does: unmount everything and reconfigure from the
		// two static mounts. Without the registry re-applying, the user's mapped
		// folder would quietly disappear mid-session.
		mounts.clear();
		await syncNativeFolderMounts();
		expect(mounts.has("/home/files/Notes")).toBe(true);
	});

	describe("path helpers", () => {
		it("recognises a mapped root but not a file inside it", async () => {
			listRoots.mockResolvedValue([root()]);
			const { syncNativeFolderMounts, isNativeMountRoot, isInsideNativeMount } =
				await load();
			await syncNativeFolderMounts();

			expect(isNativeMountRoot("/Notes")).toBe(true);
			expect(isNativeMountRoot("/Notes/")).toBe(true);
			// Deleting /Notes must be refused; deleting a file inside it is an
			// ordinary delete.
			expect(isNativeMountRoot("/Notes/a.md")).toBe(false);
			expect(isNativeMountRoot("/Projects")).toBe(false);
			expect(isInsideNativeMount("/Notes/a.md")).toBe(true);
			expect(isInsideNativeMount("/Projects/a.md")).toBe(false);
		});

		it("renames a mapped folder that would shadow an existing one", async () => {
			// Mounting over a folder the user already has would hide their files.
			readdir.mockImplementation(async (path: string) =>
				path === "/home/files/Notes" ? ["existing.md"] : [],
			);
			listRoots.mockResolvedValue([root()]);
			const { syncNativeFolderMounts } = await load();
			await syncNativeFolderMounts();

			expect(mount).toHaveBeenCalledWith(
				"/home/files/Notes (2)",
				expect.anything(),
			);
		});
	});
});
