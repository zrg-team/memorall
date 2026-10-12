import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	files: new Map<string, Uint8Array>(),
	rename: vi.fn(),
	children: vi.fn(async () => []),
	resolve: vi.fn(),
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		getFolderChildren: mocks.children,
		resolveNode: mocks.resolve,
	},
}));
vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	isInsideNativeMount: () => false,
}));
vi.mock("@/services/filesystem/fs", () => ({
	initializeFs: async () => {},
	default: {
		promises: {
			mkdir: async () => {},
			writeFile: async (path: string, data: Uint8Array) => {
				mocks.files.set(path, data);
			},
			rename: mocks.rename,
			rm: async (path: string) => {
				mocks.files.delete(path);
			},
		},
	},
}));
import { documentLibrary, zenIndexStore } from "../storage-io";
beforeEach(() => {
	mocks.files.clear();
	vi.clearAllMocks();
	mocks.rename.mockImplementation(async (from: string, to: string) => {
		mocks.files.set(to, mocks.files.get(from)!);
		mocks.files.delete(from);
	});
});
describe("index store checkpoints and directory scans", () => {
	it("publishes completed writes atomically and preserves the old checkpoint after a failed replacement", async () => {
		await zenIndexStore.write("/home/indexes/checkpoint.json", "before");
		expect(
			new TextDecoder().decode(
				mocks.files.get("/home/indexes/checkpoint.json"),
			),
		).toBe("before");
		mocks.rename.mockRejectedValueOnce(new Error("Interrupted"));
		await expect(
			zenIndexStore.write("/home/indexes/checkpoint.json", "after"),
		).rejects.toThrow("Interrupted");
		expect(
			new TextDecoder().decode(
				mocks.files.get("/home/indexes/checkpoint.json"),
			),
		).toBe("before");
		expect([...mocks.files.keys()]).toEqual(["/home/indexes/checkpoint.json"]);
	});
	it("lists just the requested directory without resolving the entire library tree", async () => {
		await documentLibrary.listFolder("/Work");
		expect(mocks.children).toHaveBeenCalledWith("/Work");
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
});
