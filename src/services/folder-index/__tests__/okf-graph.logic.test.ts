import { describe, expect, it } from "vitest";
import { FolderIndexer } from "../folder-indexer";
import { buildFileConcept, keptSections } from "../okf/concept";
import { extractMarkdownLinks } from "../okf/content-summary";
import { parseOkfDocument, serializeOkfDocument } from "../okf/frontmatter";
import { OkfIndex, okfCardPath } from "../okf/okf-index";
import { OkfReader, readCardBody } from "../okf/okf-query";
import type { IndexedFileInfo } from "../types";
import { memoryLibrary, memoryStore } from "./test-io";

const now = new Date("2026-10-11T12:00:00.000Z");
const file: IndexedFileInfo = {
	path: "/proj/ROADMAP.md",
	name: "ROADMAP.md",
	documentType: "markdown",
	size: 10,
	modifiedAt: "2026-10-01T00:00:00.000Z",
};

describe("links in markdown files", () => {
	it("resolves relative and root links, and skips web, anchors and images", () => {
		const text = [
			"See [the design](./docs/design.md) and [notes](<../notes/a b.md#top>).",
			"[root](/shared/glossary.md), [web](https://example.com), [anchor](#x)",
			"![diagram](./img/arch.png) [self](ROADMAP.md) [enc](docs/My%20Plan.md)",
		].join("\n");
		expect(extractMarkdownLinks(text, file.path)).toEqual([
			"/proj/docs/design.md",
			"/notes/a b.md",
			"/shared/glossary.md",
			"/proj/docs/My Plan.md",
		]);
	});
});

describe("card body", () => {
	it("fences the excerpt and lists links as bundle-relative card links", () => {
		const card = buildFileConcept(
			file,
			{
				excerpt: "# Heading inside the file\n```js\ncode\n```",
				links: ["/proj/docs/design.md", "/elsewhere/x.md"],
			},
			null,
			now,
			"/proj",
		);
		expect(card.body).toContain("````text\n# Heading inside the file");
		expect(card.body).toContain("* [design.md](/docs/design.md.md)");
		expect(card.body).toContain("* [x.md](memorall-file:///elsewhere/x.md)");
		// The file's own heading is not taken for a section someone added.
		expect(keptSections(card.body)).toEqual([]);
	});

	it("keeps only what was added outside the indexer's part", () => {
		const card = buildFileConcept(file, { excerpt: "# H" }, null, now);
		const edited = { ...card, body: `${card.body}\n\n# Notes\nMine.` };
		const rebuilt = buildFileConcept(file, { excerpt: "# H2" }, edited, now);
		expect(rebuilt.body.match(/# Notes/g)).toHaveLength(1);
		expect(rebuilt.body).toContain("# H2");
		expect(rebuilt.body).not.toContain("````text\n# H\n");
		// A card from before the markers is rewritten from scratch.
		expect(
			keptSections("# File\n- x\n\n# Excerpt\n\n# Pasted heading"),
		).toEqual([]);
		expect(
			parseOkfDocument(serializeOkfDocument(rebuilt)).body.includes(
				"<!-- okf-indexer:end -->",
			),
		).toBe(true);
	});
});

describe("reading a card for display", () => {
	it("splits facts, excerpt, links and added notes", () => {
		const card = buildFileConcept(
			file,
			{
				facts: ["Lines: 9"],
				excerpt: "# Heading\n[x](./y.md)",
				links: ["/proj/docs/design.md"],
			},
			null,
			now,
			"/proj",
		);
		const body = `${card.body}\n\n# Notes\nShip it.`;
		expect(readCardBody(body, file.path, "/proj")).toEqual({
			facts: [
				"Path: /proj/ROADMAP.md",
				"Size: 10 B",
				"Modified: 2026-10-01T00:00:00.000Z",
				"Lines: 9",
			],
			excerpt: "# Heading\n[x](./y.md)",
			links: ["/proj/docs/design.md"],
			notes: "# Notes\nShip it.",
		});
	});
});

describe("index graph", () => {
	it("draws folders holding cards and cards linking to cards", async () => {
		const store = memoryStore();
		const library = memoryLibrary({
			"/proj/ROADMAP.md": {
				content:
					"# Roadmap\n\nBuild on [the design](docs/design.md) and [api](./docs/api.md).",
				documentType: "markdown",
			},
			"/proj/docs/design.md": {
				content: "# Design\n\nSee the [roadmap](../ROADMAP.md).",
				documentType: "markdown",
			},
			"/proj/docs/api.md": { content: "# API", documentType: "markdown" },
			"/proj/notes.txt": { content: "plain [not a link](x.md)" },
		});
		const indexer = new FolderIndexer(store, library);
		indexer.register(new OkfIndex({ store, library, now: () => now }));
		await indexer.setFolderType("/proj", "okf", true);
		await indexer.whenIdle();
		expect(await store.read(okfCardPath("/proj/ROADMAP.md"))).toContain(
			"# Links",
		);

		const graph = await new OkfReader(store).graph("/proj", "/proj");
		expect(graph.nodes.map((node) => `${node.kind}:${node.id}`).sort()).toEqual(
			[
				"card:/proj/ROADMAP.md",
				"card:/proj/docs/api.md",
				"card:/proj/docs/design.md",
				"card:/proj/notes.txt",
				"folder:/proj",
				"folder:/proj/docs",
			],
		);
		const links = graph.edges
			.filter((edge) => edge.kind === "link")
			.map((edge) => `${edge.source} -> ${edge.target}`)
			.sort();
		expect(links).toEqual([
			"/proj/ROADMAP.md -> /proj/docs/api.md",
			"/proj/ROADMAP.md -> /proj/docs/design.md",
			"/proj/docs/design.md -> /proj/ROADMAP.md",
		]);
		expect(graph.edges.filter((edge) => edge.kind === "contains")).toHaveLength(
			5,
		);
		expect(graph.truncated).toBe(false);
	});
});
