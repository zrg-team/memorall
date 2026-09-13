import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeFolderChange } from "@/platform/contracts/core";

/**
 * Turning a native change event into the filesystem change the library already
 * knows how to react to. The interesting cases are the ones the native side
 * deliberately compresses: a burst it could not enumerate, and a folder that is
 * no longer mounted here.
 */

let nativeFilesystem: Record<string, unknown> | undefined;
let emit: ((change: NativeFolderChange) => void) | null = null;
const unsubscribe = vi.fn();

const watch = vi.fn(async (listener: (change: NativeFolderChange) => void) => {
	emit = listener;
	return unsubscribe;
});

vi.mock("@/platform/current", () => ({
	platform: {
		get nativeFilesystem() {
			return nativeFilesystem;
		},
	},
}));

const applyNativeFolderChange = vi.fn(
	(rootId: string, _paths: string[]): string | null =>
		rootId === "root-1" ? "/Notes" : null,
);

vi.mock("../mount-registry", () => ({
	applyNativeFolderChange: (rootId: string, paths: string[]) =>
		applyNativeFolderChange(rootId, paths),
}));

const load = async () => {
	const module = await import("../watcher");
	await module.stopNativeFolderWatcher();
	return module;
};

beforeEach(() => {
	vi.clearAllMocks();
	emit = null;
	nativeFilesystem = { watch };
});

describe("native folder watcher", () => {
	it("does not subscribe on a platform with no native filesystem", async () => {
		nativeFilesystem = undefined;
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(vi.fn());
		expect(watch).not.toHaveBeenCalled();
	});

	it("announces each changed file under its mapped root", async () => {
		const announce = vi.fn();
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(announce);

		emit?.({ rootId: "root-1", paths: ["a.md", "sub/b.md"] });

		expect(announce).toHaveBeenCalledWith({
			scope: "root",
			operation: "write",
			path: "/Notes/a.md",
		});
		expect(announce).toHaveBeenCalledWith({
			scope: "root",
			operation: "write",
			path: "/Notes/sub/b.md",
		});
	});

	it("refreshes the whole root when the change was too large to enumerate", async () => {
		const announce = vi.fn();
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(announce);

		// An unzip or a git checkout: the native side sends no paths rather than
		// thousands.
		emit?.({ rootId: "root-1", paths: [] });

		expect(announce).toHaveBeenCalledTimes(1);
		expect(announce).toHaveBeenCalledWith({
			scope: "root",
			operation: "write",
			path: "/Notes",
		});
	});

	it("drops the stale metadata before announcing", async () => {
		const announce = vi.fn();
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(announce);

		emit?.({ rootId: "root-1", paths: ["a.md"] });

		// Otherwise the tree would reload and be served the cached size again.
		expect(applyNativeFolderChange).toHaveBeenCalledWith("root-1", ["a.md"]);
	});

	it("ignores a change for a folder that is no longer mounted", async () => {
		const announce = vi.fn();
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(announce);

		emit?.({ rootId: "unmapped", paths: ["a.md"] });

		expect(announce).not.toHaveBeenCalled();
	});

	it("subscribes only once however often it is started", async () => {
		const { startNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(vi.fn());
		await startNativeFolderWatcher(vi.fn());
		expect(watch).toHaveBeenCalledTimes(1);
	});

	it("survives the native side refusing to watch", async () => {
		watch.mockRejectedValueOnce(new Error("no watcher available"));
		const { startNativeFolderWatcher } = await load();
		// A folder that cannot be watched is still perfectly usable.
		await expect(startNativeFolderWatcher(vi.fn())).resolves.toBeUndefined();
	});

	it("unsubscribes when stopped", async () => {
		const { startNativeFolderWatcher, stopNativeFolderWatcher } = await load();
		await startNativeFolderWatcher(vi.fn());
		await stopNativeFolderWatcher();
		expect(unsubscribe).toHaveBeenCalled();
	});
});
