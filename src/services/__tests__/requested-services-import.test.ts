import { describe, expect, it, vi } from "vitest";

Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: globalThis,
});

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	DOCUMENTS_SANDBOX_ROOT: "/",
	WORKSPACES_SANDBOX_ROOT: "/",
	SANDBOX_DOCUMENTS_ROOT: "/",
	SANDBOX_WORKSPACE_ROOT: "/",
	documentFileSystemService: {
		initialize: vi.fn(async () => undefined),
		onFilesystemChanged: vi.fn(() => vi.fn()),
		readFile: vi.fn(async () => new Uint8Array()),
		writeFile: vi.fn(async () => undefined),
		mkdir: vi.fn(async () => undefined),
	},
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

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: {
		execute: vi.fn(async () => ({
			promise: Promise.resolve({ status: "completed", result: {} }),
		})),
	},
}));

vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	OPS: {},
	ImageKind: {},
	getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 0 }) })),
}));

const loadAll = async (modules: Record<string, () => Promise<unknown>>) => {
	const loaded: string[] = [];
	const failures: string[] = [];
	for (const [path, load] of Object.entries(modules)) {
		if (path.includes("/__tests__/")) continue;
		try {
			await load();
			loaded.push(path);
		} catch (error) {
			failures.push(
				`${path}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return { loaded: loaded.sort(), failures };
};

describe("requested service module coverage", () => {
	it("imports requested service trees", async () => {
		const modules = {
			...import.meta.glob("../background-jobs/handlers/**/*.ts"),
			...import.meta.glob("../llm/**/*.ts"),
			...import.meta.glob("../embedding/**/*.ts"),
			...import.meta.glob("../filesystem/**/*.ts"),
			...import.meta.glob("../database/**/*.ts"),
		};

		const { loaded, failures } = await loadAll(modules);

		expect(failures).toEqual([]);
		expect(loaded).toMatchSnapshot();
	}, 30000);
});
