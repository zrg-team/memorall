import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderIndexer } from "@/services/folder-index/folder-indexer";
import { OkfIndex } from "@/services/folder-index/okf/okf-index";
import { OkfReader } from "@/services/folder-index/okf/okf-query";
import { EmbeddingIndex } from "@/services/folder-index/embedding/embedding-index";
import type { FolderIndexRuntime } from "@/services/folder-index/runtime";
import {
	memoryLibrary,
	memoryStore,
} from "@/services/folder-index/__tests__/test-io";

let runtime: FolderIndexRuntime;

vi.mock("@/services/folder-index/runtime", () => ({
	getFolderIndexRuntime: async () => runtime,
}));

const { createOkfIndexTool, createOkfReadTool, createOkfSearchTool } =
	await import("../okf-tools");

const text = (result: unknown): string =>
	typeof result === "string"
		? result
		: String((result as { content?: unknown }).content ?? "");

beforeEach(() => {
	const store = memoryStore();
	const library = memoryLibrary({
		"/Work/Invoices/acme.md": {
			content: "# Acme invoice\n\nHosting, 1240 EUR, unpaid.",
			documentType: "markdown",
		},
		"/Work/Invoices/figma.txt": { content: "Figma 45 USD, paid." },
	});
	const indexer = new FolderIndexer(store, library);
	const okf = new OkfIndex({ store, library });
	indexer.register(okf);
	runtime = {
		indexer,
		okf,
		okfReader: new OkfReader(store),
		embeddings: new EmbeddingIndex({ store, library }),
	};
});

describe("OKF tools", () => {
	it("say how to add an index when there is none, only if agents may ask", async () => {
		const index = createOkfIndexTool({});
		expect(text(await index.execute({}))).toContain("Indexes › OKF");
		await runtime.indexer.setSettings({ agentsMayAsk: false });
		await runtime.indexer.whenIdle();
		expect(text(await index.execute({}))).toBe(
			"No folder has an OKF index yet.",
		);
	});

	it("list indexed folders, then a folder's index.md", async () => {
		await runtime.indexer.setFolderType("/Work", "okf", true);
		await runtime.indexer.whenIdle();
		const index = createOkfIndexTool({});
		expect(text(await index.execute({}))).toContain("- /Work (2 files");
		const folder = text(await index.execute({ path: "/Work/Invoices" }));
		expect(folder).toContain(
			"[Acme invoice](acme.md.md) - Markdown Document: Hosting, 1240 EUR, unpaid.",
		);
		expect(text(await index.execute({ path: "/Notes" }))).toContain(
			"has no OKF index",
		);
	});

	it("read a card with its trust line, and search across cards", async () => {
		await runtime.indexer.setFolderType("/Work", "okf", true);
		await runtime.indexer.whenIdle();
		const card = text(
			await createOkfReadTool({}).execute({ path: "/Work/Invoices/acme.md" }),
		);
		expect(card).toContain("trust: unverified · status: stable");
		expect(card).toContain("type: Markdown Document");

		const search = createOkfSearchTool({});
		const found = text(await search.execute({ query: "unpaid" }));
		expect(found).toContain("/Work/Invoices/acme.md");
		expect(found).not.toContain("figma");
		expect(text(await search.execute({}))).toContain("give at least one");
	});
});
