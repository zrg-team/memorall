import { beforeAll, describe, expect, it, vi } from "vitest";

const memoryStore = new Map<string, unknown>();

vi.mock("@/main/modules/files/handlers/pdf-extraction", () => ({
	readPDFFile: vi.fn(async () => ""),
}));

vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	ImageKind: {},
	OPS: {},
	getDocument: vi.fn(() => ({
		promise: Promise.resolve({ destroy: vi.fn(), numPages: 0 }),
	})),
}));

vi.mock("@zenfs/core", () => ({
	configure: vi.fn(async () => undefined),
	InMemory: {},
	fs: {
		promises: {
			mkdir: vi.fn(async () => undefined),
			readFile: vi.fn(async () => new Uint8Array()),
			readdir: vi.fn(async () => []),
			stat: vi.fn(async () => ({ isDirectory: () => true })),
			writeFile: vi.fn(async () => undefined),
		},
		umount: vi.fn(async () => undefined),
	},
}));

vi.mock("@zenfs/dom", () => ({
	IndexedDB: {},
}));

beforeAll(() => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: globalThis,
	});
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: undefined,
	});
	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: {
			runtime: {
				getURL: (path: string) => path,
				sendMessage: vi.fn(() => Promise.resolve({})),
				onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			storage: {
				local: {
					get: vi.fn(async (key?: string) =>
						typeof key === "string" ? { [key]: memoryStore.get(key) } : {},
					),
					set: vi.fn(async (items: Record<string, unknown>) => {
						for (const [key, value] of Object.entries(items)) {
							memoryStore.set(key, value);
						}
					}),
					remove: vi.fn(async (key: string) => {
						memoryStore.delete(key);
					}),
				},
			},
		},
	});
	Object.defineProperty(globalThis.navigator, "credentials", {
		configurable: true,
		value: {
			get: vi.fn(async () => null),
			create: vi.fn(async () => null),
		},
	});
});

describe("src/utils module coverage", () => {
	it("imports every utility module without requiring browser storage", async () => {
		const modules = import.meta.glob("../*.ts");
		const imported: string[] = [];

		for (const [path, load] of Object.entries(modules)) {
			if (path.includes("/__tests__/")) continue;
			const mod = (await load()) as Record<string, unknown>;
			expect(mod).toBeTruthy();
			imported.push(path);
		}

		expect(imported.sort()).toMatchSnapshot();
	}, 30000);

	it("covers representative utility behavior", async () => {
		const { isAbortError, ABORT_ERROR_MESSAGE } = await import("../abort");
		const { sanitizeForJson } = await import("../sanitize-json");
		const { splitOpenUIContent } = await import("../openui");
		const { formatYAML } = await import("../yaml");
		const { v4 } = await import("../uuid");
		const { IndexedDBLogStorage } = await import("../indexeddb-storage");

		expect(isAbortError(new Error(ABORT_ERROR_MESSAGE))).toBe(true);
		expect(sanitizeForJson({ keep: "value", drop: undefined })).toEqual({
			keep: "value",
			drop: null,
		});
		expect(splitOpenUIContent('root = CardBlock("A", "B", [])')).toEqual(
			expect.arrayContaining([expect.objectContaining({ kind: "openui" })]),
		);
		expect(formatYAML({ a: 1 })).toBe("input:\n  a: 1");
		expect(v4()).toMatch(/^[0-9a-f-]{36}$/);
		expect(new IndexedDBLogStorage().isAvailable()).toBe(false);
	});
});
