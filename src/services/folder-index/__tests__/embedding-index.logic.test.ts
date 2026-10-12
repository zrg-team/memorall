import { describe, expect, it, vi } from "vitest";
import type {
	MultimodalEmbeddingEncoder,
	MultimodalEmbeddingInput,
} from "@/services/embedding/interfaces/multimodal-embedding";
import { EmbeddingIndex, normalizedVector } from "../embedding/embedding-index";
import { copyAudioWindow, mediaRanges, textChunks } from "../embedding/chunks";
import type { PreparedChunk } from "../embedding/types";
import { FolderIndexer } from "../folder-indexer";
import { indexRootOf, indexRoots, parentFolder } from "../index-config";
import { memoryLibrary, memoryStore } from "./test-io";

const encoder = (): MultimodalEmbeddingEncoder & {
	embed: ReturnType<typeof vi.fn>;
} => ({
	fingerprint: "test-space-v1",
	dimensions: 3,
	embed: vi.fn(async (input: MultimodalEmbeddingInput) =>
		input.kind === "text"
			? input.text.includes("piano")
				? [2, 0, 0]
				: [0, 2, 0]
			: [2, 0, 0],
	),
});
const setup = () => {
	const store = memoryStore();
	const library = memoryLibrary({
		"/Music/notes.md": {
			content: "An introduction. ".repeat(500) + "A piano in a sunny room.",
			documentType: "markdown",
		},
		"/Music/cats.txt": { content: "A cat asleep on the sofa." },
	});
	const model = encoder();
	let clock = new Date("2026-10-12T12:00:00Z").getTime();
	const embeddings = new EmbeddingIndex({
		store,
		library,
		encoder: model,
		now: () => new Date(clock),
		wait: async () => {},
	});
	return {
		store,
		library,
		model,
		embeddings,
		advance: (ms: number) => {
			clock += ms;
		},
	};
};
const files = async (library: ReturnType<typeof memoryLibrary>) =>
	(await library.listFolder("/Music")).map((file) => ({
		path: file.path,
		name: file.name,
		size: file.size!,
		modifiedAt: file.modifiedAt!,
		documentType: file.documentType!,
	}));

describe("EmbeddingGemma content index", () => {
	it("catches up saved folder rules when indexing resumes after outside edits", async () => {
		const { store, library, model, embeddings } = setup();
		const first = new FolderIndexer(store, library);
		first.register(embeddings);
		await first.setFolderType("/Music", "embeddings", true);
		await first.whenIdle();
		library.files.set("/Music/notes.md", {
			content: "A different piano performance.",
			modifiedAt: "2026-10-12T13:00:00Z",
		});
		library.files.delete("/Music/cats.txt");
		library.files.set("/Music/new.txt", { content: "New notes." });
		const resumedIndex = new EmbeddingIndex({ store, library, encoder: model });
		const restarted = new FolderIndexer(store, library);
		restarted.register(resumedIndex);
		restarted.resume();
		await restarted.whenIdle();
		expect(
			(await resumedIndex.chunks("/Music/notes.md", "/Music"))[0].text,
		).toBe("A different piano performance.");
		expect(await resumedIndex.chunks("/Music/cats.txt", "/Music")).toEqual([]);
		expect(
			(await resumedIndex.chunks("/Music/new.txt", "/Music"))[0].text,
		).toBe("New notes.");
		expect(await resumedIndex.status("/Music")).toMatchObject({
			entries: 2,
			errors: [],
		});
	});
	it("embeds full content beyond the OKF excerpt and retrieves a precise source chunk after reload", async () => {
		const { store, library, model, embeddings } = setup();
		await embeddings.sync("/Music", await files(library));
		const reloaded = new EmbeddingIndex({ store, library, encoder: model });
		const result = await reloaded.search({ query: "piano", limit: 1 }, [
			"/Music",
		]);
		expect(result.hits[0]).toMatchObject({
			path: "/Music/notes.md",
			kind: "text",
			score: 1,
		});
		expect(result.hits[0].text).toContain("piano");
		expect(result.hits[0].location.startChar).toBeGreaterThan(1500);
		expect(result.hits[0]).not.toHaveProperty("vector");
		expect(await reloaded.status("/Music")).toMatchObject({
			entries: 2,
			files: 2,
			errors: [],
		});
	});
	it("does not read or re-embed unchanged files, refreshes changed ones and deletes removed chunks", async () => {
		const { library, model, embeddings } = setup();
		await embeddings.sync("/Music", await files(library));
		model.embed.mockClear();
		const read = vi.spyOn(library, "readFile");
		expect(await embeddings.sync("/Music", await files(library))).toMatchObject(
			{ unchanged: 2 },
		);
		expect(read).not.toHaveBeenCalled();
		expect(model.embed).not.toHaveBeenCalled();
		library.files.set("/Music/notes.md", {
			content: "A cat.",
			modifiedAt: "2026-10-12T12:00:00Z",
		});
		library.files.delete("/Music/cats.txt");
		expect(await embeddings.sync("/Music", await files(library))).toMatchObject(
			{ updated: 1, removed: 1 },
		);
		const result = await embeddings.search({ query: "piano" }, ["/Music"]);
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0].score).toBe(0);
	});
	it("passes real media payloads to the encoder and preserves timestamps without invented captions", async () => {
		const { store, library, model } = setup();
		const samples = new Float32Array([0.2, -0.2]);
		const frames = [{ bytes: new ArrayBuffer(8), timestamp: 0 }];
		const prepared: PreparedChunk[] = [
			{
				kind: "image",
				location: {},
				input: {
					kind: "image",
					bytes: new ArrayBuffer(4),
					mimeType: "image/png",
				},
			},
			{
				kind: "audio",
				location: { startSeconds: 28, endSeconds: 58 },
				input: { kind: "audio", samples, sampleRate: 16000 },
			},
			{
				kind: "video",
				location: { startSeconds: 18, endSeconds: 38 },
				input: { kind: "video", frames, duration: 20 },
			},
		];
		const embeddings = new EmbeddingIndex({
			store,
			library,
			encoder: model,
			extract: async function* () {
				yield* prepared;
			},
		});
		await embeddings.sync("/Music", (await files(library)).slice(0, 1));
		expect(model.embed.mock.calls.map(([input]) => input)).toEqual(
			prepared.map((chunk) => chunk.input),
		);
		const result = await embeddings.search({ query: "piano", kind: "audio" }, [
			"/Music",
		]);
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0].location).toEqual({
			startSeconds: 28,
			endSeconds: 58,
		});
		expect(result.hits[0].text).toBeUndefined();
	});
	it("reports unsupported formats and failed updates, removes stale chunks, and retries failed files", async () => {
		const { store, library, model, embeddings, advance } = setup();
		await embeddings.sync("/Music", await files(library));
		library.files.set("/Music/notes.md", {
			content: "new piano recording",
			modifiedAt: "2026-10-12",
		});
		library.files.set("/Music/opaque.bin", {
			content: "binary",
			documentType: "other",
		});
		model.embed.mockImplementation(async (input: MultimodalEmbeddingInput) => {
			if (
				input.kind === "text" &&
				!input.query &&
				input.text.includes("new piano")
			)
				throw new Error("Model failed");
			return [1, 0, 0];
		});
		expect(await embeddings.sync("/Music", await files(library))).toMatchObject(
			{ skipped: 2, unchanged: 1 },
		);
		expect((await embeddings.status("/Music")).errors).toHaveLength(2);
		expect(
			(await embeddings.search({ query: "piano" }, ["/Music"])).hits.map(
				(hit) => hit.path,
			),
		).toEqual(["/Music/cats.txt"]);
		model.embed.mockResolvedValue([1, 0, 0]);
		const reads = vi.spyOn(library, "readFile");
		expect(await embeddings.sync("/Music", await files(library))).toMatchObject(
			{ skipped: 2 },
		);
		expect(reads).not.toHaveBeenCalled();
		advance(30_001);
		expect(await embeddings.sync("/Music", await files(library))).toMatchObject(
			{ updated: 1, skipped: 1 },
		);
		expect((await embeddings.chunks("/Music/notes.md", "/Music"))[0].text).toBe(
			"new piano recording",
		);
		expect(
			[...store.files.values()].some((text) =>
				text.includes("An introduction"),
			),
		).toBe(false);
	});
	it("never searches another model's space and rebuilds after its fingerprint changes", async () => {
		const { store, library, model, embeddings } = setup();
		await embeddings.sync("/Music", await files(library));
		const next = new EmbeddingIndex({
			store,
			library,
			encoder: { ...model, fingerprint: "another-space" },
		});
		model.embed.mockClear();
		expect((await next.search({ query: "piano" }, ["/Music"])).hits).toEqual(
			[],
		);
		expect(model.embed).not.toHaveBeenCalled();
		await next.sync("/Music", await files(library));
		expect(
			(await next.search({ query: "piano", limit: 1 }, ["/Music"])).hits[0]
				.score,
		).toBe(1);
	});
	it("respects folder exclusions immediately, including before the background resync", async () => {
		const { store, library, model } = setup();
		library.files.set("/Music/Private/notes.txt", { content: "private piano" });
		const embeddings = new EmbeddingIndex({ store, library, encoder: model });
		const indexer = new FolderIndexer(store, library);
		indexer.register(embeddings);
		await indexer.setFolderType("/Music", "embeddings", true);
		await indexer.whenIdle();
		await indexer.setFolderType("/Music/Private", "embeddings", false);
		const config = await indexer.loadConfig();
		const result = await embeddings.search(
			{ query: "piano" },
			indexRoots(config, "embeddings"),
			(path, root) =>
				indexRootOf(config, "embeddings", parentFolder(path)!) === root,
		);
		expect(result.hits.some((hit) => hit.path.includes("Private"))).toBe(false);
		await indexer.whenIdle();
	});
	it("does not download a model to search an empty index, and rejects invalid vectors", async () => {
		const { model, embeddings } = setup();
		expect(await embeddings.search({ query: "piano" }, ["/Music"])).toEqual({
			hits: [],
			searched: 0,
			truncated: false,
		});
		expect(model.embed).not.toHaveBeenCalled();
		expect(() => normalizedVector([NaN, 1, 0], 3)).toThrow("finite");
		expect(() => normalizedVector([1, 0], 3)).toThrow("3-dimensional");
		expect(() => normalizedVector([0, 0, 0], 3)).toThrow("zero");
	});
});

describe("content chunk boundaries", () => {
	it("covers all text with overlap and valid original offsets", () => {
		const text = "Hello 🌿 world. ".repeat(900);
		const chunks = [...textChunks(text, "notes.md")];
		for (const chunk of chunks)
			expect(chunk.text).toBe(
				text.slice(chunk.location.startChar, chunk.location.endChar),
			);
		expect(chunks[0].location.startChar).toBe(0);
		expect(chunks.at(-1)?.location.endChar).toBe(text.length);
		for (let i = 1; i < chunks.length; i++)
			expect(chunks[i].location.startChar).toBeLessThan(
				chunks[i - 1].location.endChar!,
			);
		expect([...textChunks("  \n ", "empty")]).toEqual([]);
	});
	it("covers long audio/video with bounded overlapping windows and no duplicate final window", () => {
		expect([...mediaRanges(61, 30)]).toEqual([
			[0, 30],
			[28, 58],
			[56, 61],
		]);
		expect([...mediaRanges(20, 20)]).toEqual([[0, 20]]);
		expect(() => [...mediaRanges(Infinity, 20)]).toThrow();
	});
	it("downmixes stereo and resamples to 16 kHz at the source timestamp", () => {
		const buffer = {
			numberOfChannels: 2,
			sampleRate: 8000,
			length: 4,
			duration: 4 / 8000,
			getChannelData: (channel: number) =>
				new Float32Array(channel ? [0, 0, 0, 0] : [0, 1, 0, -1]),
		} as AudioBuffer;
		const target = new Float32Array(12);
		copyAudioWindow(target, 1, 1 + 2 / 16000, buffer);
		expect([...target.slice(0, 6)]).toEqual([0, 0, 0, 0.25, 0.5, 0.25]);
		expect(target[11]).toBe(0);
	});
});
