import { describe, expect, it } from "vitest";
import { FOLDER_INDEX_CONFIG_PATH } from "../constants";
import { FolderIndexer } from "../folder-indexer";
import { parseOkfDocument } from "../okf/frontmatter";
import { OkfIndex, okfCardPath, okfStorePath } from "../okf/okf-index";
import { OkfReader } from "../okf/okf-query";
import { memoryLibrary, memoryStore } from "./test-io";

const setup = () => {
	const store = memoryStore();
	const library = memoryLibrary({
		"/Work/Invoices/acme-2026-09.md": {
			content:
				"# Acme Cloud invoice\n\nHosting for September 2026, total 1240 EUR, unpaid.",
			documentType: "markdown",
		},
		"/Work/Invoices/figma.txt": {
			content: "Figma subscription 45 USD due 2026-10-20.",
		},
		"/Work/Personal/diary.txt": { content: "private" },
		"/Work/build.tmp": { content: "x" },
		"/Notes/todo.md": {
			content: "# Todo\n\nBuy milk.",
			documentType: "markdown",
		},
	});
	let clock = new Date("2026-10-11T10:00:00.000Z");
	const okf = new OkfIndex({ store, library, now: () => clock });
	const indexer = new FolderIndexer(store, library);
	indexer.register(okf);
	return {
		store,
		library,
		indexer,
		okf,
		reader: new OkfReader(store),
		tick: (iso: string) => {
			clock = new Date(iso);
		},
	};
};

describe("folder indexer with OKF", () => {
	it("exposes live counts across subfolders and clears them when the run finishes", async () => {
		const { library, indexer, okf } = setup();
		const readFile = library.readFile;
		let release!: () => void;
		let started!: () => void;
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const secondFile = new Promise<void>((resolve) => {
			started = resolve;
		});
		let reads = 0;
		library.readFile = async (path) => {
			if (++reads === 2) {
				started();
				await paused;
			}
			return readFile(path);
		};
		await indexer.setFolderType("/Work", "okf", true);
		try {
			await secondFile;
			expect((await indexer.getState()).progress).toEqual({
				"okf:/Work": { total: 3, successful: 1, indexing: 1, failed: 0 },
			});
		} finally {
			release();
			await indexer.whenIdle();
		}
		expect((await indexer.getState()).progress).toEqual({});
		const { files } = await indexer.collectFiles(
			await indexer.loadConfig(),
			"okf",
			"/Work",
		);
		const progress: unknown[] = [];
		await okf.sync("/Work", files, {
			onProgress: (value) => progress.push(value),
		});
		expect(progress.at(-1)).toEqual({
			total: 3,
			successful: 3,
			indexing: 0,
			failed: 0,
		});
		// Existing, current cards count as successful without reading the source again.
		expect(reads).toBe(3);
	});

	it("clears live counts when an index run fails", async () => {
		const { indexer, store } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.whenIdle();
		const write = store.write;
		store.write = async (path, text) => {
			if (path.endsWith("/index.md")) throw new Error("Disk full");
			return write(path, text);
		};
		await expect(indexer.syncRoot("okf", "/Work")).rejects.toThrow("Disk full");
		expect(await indexer.getState()).toMatchObject({
			running: [],
			progress: {},
		});
	});

	it("builds a bundle for a folder: cards, index.md per folder, log.md at the root", async () => {
		const { store, indexer } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.whenIdle();

		expect(
			JSON.parse((await store.read(FOLDER_INDEX_CONFIG_PATH)) as string)
				.folders,
		).toEqual({
			"/Work": { on: ["okf"] },
		});
		const card = parseOkfDocument(
			(await store.read(
				okfCardPath("/Work/Invoices/acme-2026-09.md"),
			)) as string,
		);
		expect(card.frontmatter).toMatchObject({
			type: "Markdown Document",
			title: "Acme Cloud invoice",
			description: "Hosting for September 2026, total 1240 EUR, unpaid.",
		});
		// The skip pattern keeps *.tmp out; files never get written into the library.
		expect(await store.read(okfCardPath("/Work/build.tmp"))).toBeNull();

		const rootIndex = (await store.read(
			`${okfStorePath("/Work")}/index.md`,
		)) as string;
		expect(rootIndex).toContain('okf_version: "0.2"');
		expect(rootIndex).toContain("* [Invoices](Invoices/) - 2 indexed files");
		const folderIndex = (await store.read(
			`${okfStorePath("/Work/Invoices")}/index.md`,
		)) as string;
		expect(folderIndex).not.toContain("okf_version");
		expect(folderIndex).toContain(
			"[Acme Cloud invoice](acme-2026-09.md.md) - Markdown Document: Hosting",
		);
		expect(await store.read(`${okfStorePath("/Work")}/log.md`)).toContain(
			"**Initialization**: Indexed 3 files in /Work.",
		);
		expect(await store.read(okfStorePath("/Notes"))).toBeNull();
	});

	it("updates only changed files, removes cards of deleted ones and logs both", async () => {
		const { store, library, indexer, tick } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.whenIdle();

		tick("2026-10-12T10:00:00.000Z");
		library.files.set("/Work/Invoices/figma.txt", {
			content: "Figma subscription 45 USD, paid.",
			modifiedAt: "2026-10-12T09:00:00.000Z",
		});
		library.files.delete("/Work/Personal/diary.txt");
		const result = await indexer.syncRoot("okf", "/Work");

		expect(result).toMatchObject({
			created: 0,
			updated: 1,
			removed: 1,
			unchanged: 1,
		});
		expect(
			await store.read(okfCardPath("/Work/Personal/diary.txt")),
		).toBeNull();
		expect(
			await store.read(`${okfStorePath("/Work/Personal")}/index.md`),
		).toBeNull();
		const log = (await store.read(`${okfStorePath("/Work")}/log.md`)) as string;
		expect(log.indexOf("## 2026-10-12")).toBeLessThan(
			log.indexOf("## 2026-10-11"),
		);
		expect(log).toContain(
			"**Update**: Refreshed [figma.txt](/Invoices/figma.txt.md).",
		);
		expect(log).toContain("**Removal**: Removed diary.txt.");
	});

	it("drops a subfolder that leaves the index, and the whole bundle when turned off", async () => {
		const { store, indexer } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.whenIdle();
		await indexer.setFolderType("/Work/Personal", "okf", false);
		await indexer.whenIdle();
		expect(
			await store.read(okfCardPath("/Work/Personal/diary.txt")),
		).toBeNull();
		expect(
			await store.read(okfCardPath("/Work/Invoices/figma.txt")),
		).not.toBeNull();

		await indexer.setFolderType("/Work", "okf", false);
		await indexer.whenIdle();
		expect(
			[...store.files.keys()].filter((key) =>
				key.startsWith(okfStorePath("/Work")),
			),
		).toEqual([]);
	});

	it("leaves a nested root's bundle alone when its parent root syncs", async () => {
		const { store, library, indexer } = setup();
		library.files.set("/Work/Personal/Taxes/2025.txt", {
			content: "Tax return 2025.",
		});
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.setFolderType("/Work/Personal", "okf", false);
		await indexer.setFolderType("/Work/Personal/Taxes", "okf", true);
		await indexer.whenIdle();
		await indexer.syncRoot("okf", "/Work");

		expect(
			await store.read(okfCardPath("/Work/Personal/Taxes/2025.txt")),
		).not.toBeNull();
		expect(
			await store.read(okfCardPath("/Work/Personal/diary.txt")),
		).toBeNull();
		expect(
			await store.read(`${okfStorePath("/Work/Personal/Taxes")}/index.md`),
		).toContain('okf_version: "0.2"');
		expect(await store.read(`${okfStorePath("/Work")}/index.md`)).not.toContain(
			"Personal",
		);
	});

	it("keeps a person's edits to a card through later syncs", async () => {
		const { store, library, indexer, okf } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.whenIdle();
		await okf.curate(
			"/Work/Invoices/figma.txt",
			{ type: "Invoice", tags: ["saas", "unpaid"] },
			"human:me",
		);
		library.files.set("/Work/Invoices/figma.txt", {
			content: "changed",
			modifiedAt: "2026-10-13T00:00:00.000Z",
		});
		await indexer.syncRoot("okf", "/Work");

		const card = parseOkfDocument(
			(await store.read(okfCardPath("/Work/Invoices/figma.txt"))) as string,
		);
		expect(card.frontmatter).toMatchObject({
			type: "Invoice",
			tags: ["saas", "unpaid"],
		});
		expect(card.frontmatter.verified).toEqual([
			{ by: "human:me", at: "2026-10-11T10:00:00.000Z" },
		]);
		expect(card.body).toContain("changed");
	});

	it("searches cards by words, type, tags and folder, across bundles", async () => {
		const { indexer, okf, reader } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.setFolderType("/Notes", "okf", true);
		await indexer.whenIdle();
		await okf.curate(
			"/Work/Invoices/figma.txt",
			{ type: "Invoice", tags: ["unpaid"] },
			"human:me",
		);
		const roots = ["/Notes", "/Work"];

		const byWords = await reader.search({ query: "unpaid acme" }, roots);
		expect(byWords.hits[0].path).toBe("/Work/Invoices/acme-2026-09.md");
		expect(
			(await reader.search({ type: "invoice" }, roots)).hits.map(
				(hit) => hit.path,
			),
		).toEqual(["/Work/Invoices/figma.txt"]);
		expect(
			(await reader.search({ tags: ["unpaid"] }, roots)).hits,
		).toHaveLength(1);
		expect(
			(await reader.search({ query: "milk", folder: "/Work" }, roots)).hits,
		).toHaveLength(0);
		expect((await reader.search({ query: "milk" }, roots)).hits[0].path).toBe(
			"/Notes/todo.md",
		);
	});

	it("reads a card by its file path or by the card's own name", async () => {
		const { indexer, reader } = setup();
		await indexer.setFolderType("/Notes", "okf", true);
		await indexer.whenIdle();
		expect((await reader.readCard("/Notes/todo.md"))?.path).toBe(
			"/Notes/todo.md",
		);
		expect((await reader.readCard("/Notes/todo.md.md"))?.path).toBe(
			"/Notes/todo.md",
		);
		expect(await reader.readCard("/Notes/missing.md")).toBeNull();
	});

	it("reports indexed folders and their status", async () => {
		const { indexer } = setup();
		await indexer.setFolderType("/Work", "okf", true);
		await indexer.setFolderType("/Work/Personal", "okf", false);
		await indexer.whenIdle();
		const state = await indexer.getState();
		expect(state.types.map((type) => type.id)).toEqual(["okf"]);
		expect(state.folders).toEqual([
			expect.objectContaining({
				path: "/Work",
				on: ["okf"],
				effective: ["okf"],
				status: [expect.objectContaining({ typeId: "okf", entries: 2 })],
			}),
			expect.objectContaining({
				path: "/Work/Personal",
				off: ["okf"],
				effective: [],
				status: [],
			}),
		]);
		expect(state.running).toEqual([]);
	});
});
