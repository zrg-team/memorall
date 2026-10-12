import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractToolResult } from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { emptyFolderIndexConfig } from "@/services/folder-index/index-config";
import { liftToolImages } from "@/services/llm/utils/tool-images";
import type { ChatCompletionMessageParam } from "@/types/openai";
import {
	createEmbeddingSearchTool,
	createEmbeddingChunksTool,
} from "../embedding-tools";

const mocks = vi.hoisted(() => ({
	search: vi.fn(),
	chunks: vi.fn(),
	loadConfig: vi.fn(),
	readFile: vi.fn(),
	picture: vi.fn(),
	acceptsImages: vi.fn(),
}));
vi.mock("@/services/folder-index/runtime", () => ({
	getFolderIndexRuntime: async () => ({
		indexer: { loadConfig: mocks.loadConfig },
		embeddings: { search: mocks.search, chunks: mocks.chunks },
	}),
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFile: mocks.readFile },
}));
vi.mock("@/services/memon/models-port", () => ({
	createMemonModelsPort: () => ({ acceptsImages: mocks.acceptsImages }),
}));
vi.mock("@/services/memon/page-capture", () => ({
	pictureOfImage: mocks.picture,
}));

const root = "/agents/Ten Thousand Victories Launchpad";
const hit = (name: string, kind = "image", text?: string) => ({
	path: `${root}/assets/${name}`,
	id: `${root}/assets/${name}#0`,
	title: name,
	kind,
	text,
	location: {},
	score: 0.716,
});
beforeEach(() => {
	vi.resetAllMocks();
	mocks.loadConfig.mockResolvedValue({
		...emptyFolderIndexConfig(),
		folders: { [root]: { on: ["embeddings"] } },
	});
	mocks.search.mockResolvedValue({
		hits: [hit("portraits.webp"), hit("faces.webp")],
		searched: 1434,
		truncated: false,
	});
	mocks.acceptsImages.mockResolvedValue(true);
	mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
	mocks.picture.mockResolvedValue({
		dataUrl: "data:image/png;base64,AAA",
		width: 1024,
		height: 512,
	});
});

describe("embedding evidence supplied to the agent", () => {
	it("passes source image previews and exact paths through the result envelope to the model", async () => {
		const result = await createEmbeddingSearchTool({}).execute({
			query: "nón lá",
			kind: "image",
			folder: root,
		});
		const extracted = extractToolResult(result);
		expect(Array.isArray(extracted.content)).toBe(true);
		expect(extracted.imageUrls).toEqual([
			"data:image/png;base64,AAA",
			"data:image/png;base64,AAA",
		]);
		expect(extracted.structuredContent).toMatchObject({
			query: "nón lá",
			searched: 1434,
			hits: [
				{ path: hit("portraits.webp").path },
				{ path: hit("faces.webp").path },
			],
			previewPaths: [hit("portraits.webp").path, hit("faces.webp").path],
		});
		expect(extracted.contentText).toContain(
			"Inspect these source previews now",
		);
		expect(extracted.contentText).toContain(
			"Text grep cannot inspect image content",
		);
		expect(extracted.contentText.match(/"actionType"/g)).toHaveLength(1);
		const messages = liftToolImages([
			{
				role: "tool",
				tool_call_id: "search-images",
				content: extracted.content,
			} as ChatCompletionMessageParam,
		]);
		expect(messages).toMatchObject([
			{
				role: "tool",
				content: expect.stringContaining(hit("portraits.webp").path),
			},
			{
				role: "user",
				content: [
					{ type: "text" },
					{ type: "image_url" },
					{ type: "image_url" },
				],
			},
		]);
		expect(mocks.picture).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			"image/webp",
		);
	});
	it("attaches at most three distinct images without collapsing the source matches", async () => {
		mocks.search.mockResolvedValue({
			hits: [
				hit("a.png"),
				hit("a.png"),
				hit("b.png"),
				hit("c.png"),
				hit("d.png"),
			],
			searched: 5,
			truncated: false,
		});
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(extracted.imageUrls).toHaveLength(3);
		expect(mocks.readFile.mock.calls.map(([path]) => path)).toEqual([
			hit("a.png").path,
			hit("b.png").path,
			hit("c.png").path,
		]);
		expect(extracted.structuredContent).toMatchObject({
			hits: expect.arrayContaining([
				expect.objectContaining({ path: hit("d.png").path }),
			]),
		});
	});
	it("keeps paths and inspection guidance without image parts for a model without vision", async () => {
		mocks.acceptsImages.mockResolvedValue(false);
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(typeof extracted.content).toBe("string");
		expect(mocks.readFile).not.toHaveBeenCalled();
		expect(extracted.contentText).toContain("image-captioning tool");
		expect(extracted.contentText).toContain(hit("portraits.webp").path);
	});
	it("retains useful matches when one image preview is unavailable", async () => {
		mocks.readFile.mockRejectedValueOnce(new Error("Image was moved"));
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(extracted.isError).toBe(false);
		expect(extracted.imageUrls).toHaveLength(1);
		expect(extracted.structuredContent).toMatchObject({
			hits: expect.any(Array),
			previewWarnings: [
				{ path: hit("portraits.webp").path, message: "Image was moved" },
			],
			previewPaths: [hit("faces.webp").path],
		});
	});
	it("preserves scanned-page locations without treating a PDF as an image file", async () => {
		mocks.search.mockResolvedValue({
			hits: [{ ...hit("research.pdf"), location: { page: 4 } }],
			searched: 10,
			truncated: false,
		});
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(mocks.readFile).not.toHaveBeenCalled();
		expect(extracted.structuredContent).toMatchObject({
			hits: [{ path: hit("research.pdf").path, location: { page: 4 } }],
		});
		expect(extracted.contentText).toContain("render the source page");
	});
	it("returns valid bounded structured text instead of cutting a result mid-record", async () => {
		mocks.acceptsImages.mockResolvedValue(false);
		mocks.search.mockResolvedValue({
			hits: Array.from({ length: 50 }, (_, i) =>
				hit(`${i}.md`, "text", "content ".repeat(1000)),
			),
			searched: 50,
			truncated: false,
		});
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(() => JSON.parse(extracted.content as string)).not.toThrow();
		expect(extracted.structuredContent).toMatchObject({
			truncated: true,
			matched: 50,
		});
		expect(extracted.contentText).not.toContain("undefined");
	});
	it("does not read images when there are no indexed folders or no image matches", async () => {
		mocks.loadConfig.mockResolvedValueOnce(emptyFolderIndexConfig());
		await createEmbeddingSearchTool({}).execute({ query: "hat" });
		expect(mocks.search).not.toHaveBeenCalled();
		mocks.search.mockResolvedValue({ hits: [], searched: 0, truncated: false });
		const extracted = extractToolResult(
			await createEmbeddingSearchTool({}).execute({ query: "hat" }),
		);
		expect(mocks.readFile).not.toHaveBeenCalled();
		expect(extracted.structuredContent).toMatchObject({ hits: [], matched: 0 });
	});
	it("also passes the source image when inspecting its indexed chunks", async () => {
		const { score: _score, ...chunk } = hit("portraits.webp");
		mocks.chunks.mockResolvedValue([chunk]);
		const extracted = extractToolResult(
			await createEmbeddingChunksTool({}).execute({ path: chunk.path }),
		);
		expect(extracted.imageUrls).toHaveLength(1);
		expect(extracted.structuredContent).toMatchObject({
			actionType: "embedding_chunks",
			path: chunk.path,
			total: 1,
			hits: [expect.not.objectContaining({ score: expect.anything() })],
		});
	});
});
