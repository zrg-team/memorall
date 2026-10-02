import { describe, expect, it, vi } from "vitest";

/**
 * `refreshFsCache()` reloads `/home` so this context sees another context's
 * writes. It used to unmount `/home` while this context's own calls were still
 * running: a `mkdir` in that gap reported success and vanished, and the file
 * written into it next failed with ENOENT — an agent saving a batch of images
 * lost every one.
 *
 * IndexedDB is stood in for by a store that outlives each mount, which is what
 * makes a lost write show up after a remount.
 */

const backend = vi.hoisted(() => ({ creates: 0, store: null as unknown }));

vi.mock("@zenfs/dom", async () => {
	const { InMemoryStore, StoreFS } = await import("@zenfs/core");
	return {
		IndexedDB: {
			name: "IndexedDB",
			options: {},
			create: () => {
				backend.creates++;
				backend.store ??= new InMemoryStore(undefined, "idb");
				return new StoreFS(backend.store as InstanceType<typeof InMemoryStore>);
			},
		},
	};
});

vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	syncNativeFolderMounts: async () => undefined,
}));

// ZenFS keeps its mounts in module state, so the module is loaded once.
const load = async () => {
	const module = await import("@/services/filesystem/fs");
	await module.initializeFs();
	return module;
};

describe("refreshFsCache", () => {
	it("keeps folders and files written while a reload is under way", async () => {
		const { default: fs, refreshFsCache } = await load();
		const folder = `/home/files/projects/house-${Date.now()}`;

		const refresh = refreshFsCache();
		const saves = Array.from({ length: 7 }, async (_, index) => {
			await fs.promises.mkdir(folder, { recursive: true });
			await fs.promises.writeFile(
				`${folder}/photo${index}.jpg`,
				new Uint8Array([index]),
			);
		});
		await Promise.all([refresh, ...saves]);

		// Load the store again: only what reached it survives.
		await refreshFsCache();
		const names = (await fs.promises.readdir(folder)).sort();
		expect(names).toEqual(
			Array.from({ length: 7 }, (_, index) => `photo${index}.jpg`),
		);
	});

	it("holds a call made during the reload until /home is back", async () => {
		const { default: fs, refreshFsCache } = await load();
		const path = `/home/files/held-${Date.now()}.txt`;

		const refresh = refreshFsCache();
		// Past the debounce, so the reload is in progress when the write starts.
		await new Promise((resolve) => setTimeout(resolve, 120));
		await fs.promises.writeFile(path, "kept");
		await refresh;

		await refreshFsCache();
		expect(await fs.promises.readFile(path, "utf8")).toBe("kept");
	});

	it("reloads once for a burst of change events", async () => {
		const { refreshFsCache } = await load();
		const before = backend.creates;

		await Promise.all(Array.from({ length: 10 }, () => refreshFsCache()));

		expect(backend.creates - before).toBe(1);
	});
});
