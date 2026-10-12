import { describe, expect, it, vi } from "vitest";
import { EmbeddingIndex } from "../embedding/embedding-index";
import { FolderIndexer } from "../folder-indexer";
import {
	EMBEDDING_GEMMA_2_DIMENSIONS,
	EMBEDDING_GEMMA_2_FINGERPRINT,
} from "@/services/embedding/implementations/embeddinggemma2-model";
import type { PreparedChunk } from "../embedding/types";
import type { IndexedFileInfo, FolderIndexType } from "../types";
import { emptyFolderIndexConfig } from "../index-config";
import { FOLDER_INDEX_CONFIG_PATH } from "../constants";
import { memoryLibrary, memoryStore } from "./test-io";

const nativeConstructor = vi.hoisted(() =>
	vi.fn(function () {
		throw new Error("Reading unchanged indexes must not instantiate the model");
	}),
);
vi.mock(
	"@/services/embedding/implementations/embeddinggemma2-embedding",
	() => ({ EmbeddingGemma2Encoder: nativeConstructor }),
);

const fixture = (count = 10) => {
	const store = memoryStore();
	const library = memoryLibrary({
		"/Work/long.txt": { content: "source content" },
	});
	const model = {
		fingerprint: "test-space",
		dimensions: 3,
		embed: vi.fn(async () => [1, 0, 0]),
	};
	const extract = async function* (): AsyncGenerator<PreparedChunk> {
		for (let i = 0; i < count; i++)
			yield {
				kind: "text",
				text: `chunk ${i}`,
				location: { startChar: i, endChar: i + 1 },
				input: { kind: "text", text: `chunk ${i}` },
			};
	};
	let clock = 1000;
	const wait = vi.fn(async (_ms: number) => {});
	const options = {
		store,
		library,
		encoder: model,
		extract,
		wait,
		now: () => new Date(clock),
	};
	const files = async (): Promise<IndexedFileInfo[]> =>
		(await library.listFolder("/Work")).map((file) => ({
			path: file.path,
			name: file.name,
			size: file.size!,
			modifiedAt: file.modifiedAt!,
			documentType: file.documentType!,
		}));
	return {
		...options,
		model,
		options,
		files,
		index: new EmbeddingIndex(options),
		advance: (ms: number) => {
			clock += ms;
		},
	};
};

describe("bounded, resumable embedding work", () => {
	it("reopening unchanged indexes neither reads vectors nor writes timestamps nor initializes the model", async () => {
		const f = fixture(1),
			[file] = await f.files();
		const root = `/home/indexes/embeddings/${encodeURIComponent("/Work")}`;
		await f.store.write(
			`${root}/manifest.json`,
			JSON.stringify({
				version: 1,
				root: "/Work",
				fingerprint: EMBEDDING_GEMMA_2_FINGERPRINT,
				dimensions: EMBEDDING_GEMMA_2_DIMENSIONS,
				updatedAt: "before",
				files: {
					[file.path]: {
						size: file.size,
						modifiedAt: file.modifiedAt,
						chunks: 1,
					},
				},
			}),
		);
		await f.store.write(
			`${root}/${encodeURIComponent(file.path)}.json`,
			JSON.stringify({
				fingerprint: EMBEDDING_GEMMA_2_FINGERPRINT,
				path: file.path,
				chunks: [
					{
						id: `${file.path}#0`,
						path: file.path,
						title: file.name,
						kind: "text",
						location: {},
						vector: [1, ...Array(767).fill(0)],
					},
				],
			}),
		);
		const reads = vi.spyOn(f.store, "read"),
			writes = vi.spyOn(f.store, "write"),
			sources = vi.spyOn(f.library, "readFile");
		const reopened = new EmbeddingIndex({ store: f.store, library: f.library });
		expect(await reopened.sync("/Work", [file])).toMatchObject({
			unchanged: 1,
		});
		expect(
			reads.mock.calls.every(([path]) => path.endsWith("manifest.json")),
		).toBe(true);
		expect(writes).not.toHaveBeenCalled();
		expect(sources).not.toHaveBeenCalled();
		expect(await reopened.status("/Work")).toMatchObject({
			updatedAt: "before",
		});
		expect(await reopened.chunks(file.path, "/Work")).toHaveLength(1);
		expect(nativeConstructor).not.toHaveBeenCalled();
	});
	it("checkpoints bounded batches and resumes the remaining chunks after reopening", async () => {
		const f = fixture(),
			controller = new AbortController();
		f.wait.mockImplementationOnce(async () => {
			controller.abort();
		});
		await f.index.sync("/Work", await f.files(), {
			signal: controller.signal,
			batchSize: 2,
			pauseMs: 300,
		});
		expect(f.model.embed).toHaveBeenCalledTimes(2);
		expect(await f.index.chunks("/Work/long.txt", "/Work")).toHaveLength(2);
		const pages = [...f.store.files].filter(([path]) =>
			path.includes(".parts/"),
		);
		expect(pages).toHaveLength(1);
		expect(JSON.parse(pages[0][1])).toHaveLength(2);
		await new EmbeddingIndex(f.options).sync("/Work", await f.files(), {
			batchSize: 2,
		});
		expect(f.model.embed).toHaveBeenCalledTimes(10);
		expect(
			(await f.index.chunks("/Work/long.txt", "/Work")).map(
				(chunk) => chunk.id,
			),
		).toEqual(Array.from({ length: 10 }, (_, i) => `/Work/long.txt#${i}`));
		expect(
			[...f.store.files.keys()].some((path) => path.includes(".parts/")),
		).toBe(false);
		expect(f.wait).toHaveBeenCalledWith(300);
	});
	it("rejects oversized text before instantiating the native model", async () => {
		const f = fixture();
		f.library.files.set("/Work/long.txt", { content: "x".repeat(3_602_001) });
		const index = new EmbeddingIndex({
			store: f.store,
			library: f.library,
			wait: f.wait,
		});
		expect(await index.sync("/Work", await f.files())).toMatchObject({
			skipped: 1,
		});
		expect((await index.status("/Work")).errors[0].message).toContain(
			"2000-chunk limit",
		);
		expect(nativeConstructor).not.toHaveBeenCalled();
	});
	it("recovers a completed document after interruption before the manifest flush", async () => {
		const f = fixture(1),
			write = f.store.write;
		f.store.write = async (path, text) => {
			if (path.endsWith("manifest.json")) throw new Error("App interrupted");
			await write(path, text);
		};
		await expect(f.index.sync("/Work", await f.files())).rejects.toThrow(
			"App interrupted",
		);
		f.store.write = write;
		f.model.embed.mockClear();
		const read = vi.spyOn(f.library, "readFile");
		expect(
			await new EmbeddingIndex(f.options).sync("/Work", await f.files()),
		).toMatchObject({ unchanged: 1 });
		expect(read).not.toHaveBeenCalled();
		expect(f.model.embed).not.toHaveBeenCalled();
	});
	it("batches manifest writes and cools down between file bursts", async () => {
		const f = fixture(1);
		f.library.files.clear();
		for (let i = 0; i < 12; i++)
			f.library.files.set(`/Work/${i}.txt`, { content: "source" });
		const writes = vi.spyOn(f.store, "write");
		await f.index.sync("/Work", await f.files());
		expect(
			writes.mock.calls.filter(([path]) => path.endsWith("manifest.json")),
		).toHaveLength(2);
		expect(f.wait).toHaveBeenCalledWith(150);
		// Four chunk batches apply across single-chunk files, plus the file-burst cooldown.
		expect(f.wait).toHaveBeenCalledTimes(4);
	});
	it("shares a query vector across concurrent searches and index refreshes", async () => {
		const f = fixture(1);
		await f.index.sync("/Work", await f.files());
		f.model.embed.mockClear();
		await Promise.all(
			Array.from({ length: 4 }, () =>
				f.index.search({ query: "hat" }, ["/Work"]),
			),
		);
		await f.index.sync("/Work", await f.files());
		await f.index.search({ query: "hat", kind: "text" }, ["/Work"]);
		expect(f.model.embed).toHaveBeenCalledTimes(1);
	});
	it("backs off unchanged failures but retries a changed source immediately", async () => {
		const f = fixture(1);
		f.model.embed.mockRejectedValueOnce(new Error("Model busy"));
		await f.index.sync("/Work", await f.files());
		const reads = vi.spyOn(f.library, "readFile");
		await f.index.sync("/Work", await f.files());
		expect(reads).not.toHaveBeenCalled();
		expect(f.model.embed).toHaveBeenCalledTimes(1);
		f.library.files.set("/Work/long.txt", {
			content: "changed content",
			modifiedAt: "2026-10-12",
		});
		expect(await f.index.sync("/Work", await f.files())).toMatchObject({
			updated: 1,
		});
		expect(f.model.embed).toHaveBeenCalledTimes(2);
	});
	it("pauses active embedding work at a checkpoint and resumes without losing completed vectors", async () => {
		const f = fixture(),
			indexer = new FolderIndexer(f.store, f.library);
		indexer.register(f.index);
		let release!: (vector: number[]) => void;
		f.model.embed.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		await indexer.setFolderType("/Work", "embeddings", true);
		await vi.waitFor(() => expect(f.model.embed).toHaveBeenCalledTimes(1));
		await indexer.setSettings({ embeddingPaused: true });
		release([1, 0, 0]);
		await indexer.whenIdle();
		expect(await f.index.status("/Work")).toMatchObject({
			chunks: 1,
			errors: [],
		});
		expect(await indexer.syncRoot("embeddings", "/Work")).toBeNull();
		await indexer.rebuild("/Work");
		await indexer.whenIdle();
		expect(await f.index.status("/Work")).toMatchObject({ chunks: 1 });
		await indexer.setSettings({ embeddingPaused: false });
		await indexer.whenIdle();
		expect(f.model.embed).toHaveBeenCalledTimes(10);
		expect(await f.index.status("/Work")).toMatchObject({
			chunks: 10,
			errors: [],
		});
	});
	it("serializes roots, coalesces queued changes, and starts resume only once", async () => {
		const store = memoryStore(),
			library = memoryLibrary({});
		await store.write(
			FOLDER_INDEX_CONFIG_PATH,
			JSON.stringify({
				...emptyFolderIndexConfig(),
				folders: { "/A": { on: ["embeddings"] }, "/B": { on: ["embeddings"] } },
			}),
		);
		let release!: () => void,
			active = 0,
			peak = 0;
		const sync = vi.fn(async () => {
			active++;
			peak = Math.max(peak, active);
			if (sync.mock.calls.length === 1)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			active--;
			return { created: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0 };
		});
		const indexer = new FolderIndexer(store, library);
		indexer.register({
			id: "embeddings",
			label: "Embeddings",
			description: "",
			prompt: "",
			tools: [],
			sync,
			remove: async () => {},
			status: async () => ({ typeId: "embeddings", entries: 0, files: 0 }),
			entries: async () => [],
		} satisfies FolderIndexType);
		const first = indexer.syncRoot("embeddings", "/A");
		await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
		const second = indexer.syncRoot("embeddings", "/B"),
			followup = indexer.syncRoot("embeddings", "/A");
		expect(indexer.syncRoot("embeddings", "/A/")).toBe(followup);
		release();
		await Promise.all([first, second, followup]);
		expect(peak).toBe(1);
		const all = vi.spyOn(indexer, "syncAll");
		indexer.resume();
		indexer.resume();
		await indexer.whenIdle();
		expect(all).toHaveBeenCalledTimes(1);
		const before = sync.mock.calls.length;
		await indexer.setSettings({ agentsMayAsk: false });
		await indexer.whenIdle();
		expect(sync).toHaveBeenCalledTimes(before);
	});
});
