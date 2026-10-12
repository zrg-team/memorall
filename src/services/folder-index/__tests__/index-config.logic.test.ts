import { describe, expect, it } from "vitest";
import {
	effectiveIndexTypes,
	emptyFolderIndexConfig,
	indexRootOf,
	indexRoots,
	isSkippedName,
	moveFolderIndexRules,
	normalizeFolderIndexConfig,
	removeFolderIndexRules,
	setFolderIndexType,
} from "../index-config";

const withOkf = (...folders: string[]) =>
	folders.reduce(
		(config, folder) => setFolderIndexType(config, folder, "okf", true),
		emptyFolderIndexConfig(),
	);

describe("folder index config", () => {
	it("passes a folder's index types down to its subfolders", () => {
		const config = withOkf("/Work");
		expect(effectiveIndexTypes(config, "/Work/Invoices/2026")).toEqual(["okf"]);
		expect(effectiveIndexTypes(config, "/Notes")).toEqual([]);
	});

	it("lets a subfolder leave an inherited index, and rejoin it", () => {
		let config = withOkf("/Work");
		config = setFolderIndexType(config, "/Work/Personal", "okf", false);
		expect(config.folders["/Work/Personal"]).toEqual({ off: ["okf"] });
		expect(effectiveIndexTypes(config, "/Work/Personal/x")).toEqual([]);
		expect(effectiveIndexTypes(config, "/Work/Contracts")).toEqual(["okf"]);

		config = setFolderIndexType(config, "/Work/Personal", "okf", true);
		expect(config.folders["/Work/Personal"]).toBeUndefined();
	});

	it("finds one root per bundle, not one per folder", () => {
		const config = withOkf("/Work", "/Work/Invoices", "/Notes");
		expect(indexRoots(config, "okf")).toEqual(["/Notes", "/Work"]);
		expect(indexRootOf(config, "okf", "/Work/Invoices/a")).toBe("/Work");
		expect(indexRootOf(config, "okf", "/Other")).toBeNull();
	});

	it("starts a new root below a folder that left the index", () => {
		let config = withOkf("/Work");
		config = setFolderIndexType(config, "/Work/Personal", "okf", false);
		config = setFolderIndexType(config, "/Work/Personal/Taxes", "okf", true);
		expect(indexRoots(config, "okf")).toEqual([
			"/Work",
			"/Work/Personal/Taxes",
		]);
	});

	it("keeps index types separate", () => {
		let config = withOkf("/Work");
		config = setFolderIndexType(config, "/Work", "vector", true);
		config = setFolderIndexType(config, "/Work/Raw", "vector", false);
		expect(effectiveIndexTypes(config, "/Work/Raw")).toEqual(["okf"]);
		expect(indexRoots(config, "vector")).toEqual(["/Work"]);
	});

	it("moves and forgets rules with their folders", () => {
		const config = withOkf("/Work", "/Notes/Daily");
		expect(
			Object.keys(
				moveFolderIndexRules(config, "/Notes", "/Archive/Notes").folders,
			).sort(),
		).toEqual(["/Archive/Notes/Daily", "/Work"]);
		expect(
			Object.keys(removeFolderIndexRules(config, "/Notes").folders),
		).toEqual(["/Work"]);
	});

	it("defaults anything missing or malformed when read", () => {
		const config = normalizeFolderIndexConfig({
			folders: {
				"/a/": { on: ["okf", "okf", 3] },
				"/b": { on: [] },
				"/c": "x",
			},
			settings: {
				maxFileBytes: -1,
				skipPatterns: ["*.bak"],
				agentsMayAsk: false,
			},
		});
		expect(config.folders).toEqual({ "/a": { on: ["okf"] } });
		expect(config.settings.maxFileBytes).toBeGreaterThan(0);
		expect(config.settings.skipPatterns).toEqual(["*.bak"]);
		expect(config.settings.agentsMayAsk).toBe(false);
	});

	it("skips files and folders by pattern", () => {
		const patterns = ["*.tmp", "node_modules/"];
		expect(isSkippedName("draft.TMP", "file", patterns)).toBe(true);
		expect(isSkippedName("node_modules", "folder", patterns)).toBe(true);
		expect(isSkippedName("node_modules", "file", patterns)).toBe(false);
		expect(isSkippedName("notes.md", "file", patterns)).toBe(false);
	});
	it("defaults and bounds background embedding controls", () => {
		expect(emptyFolderIndexConfig().settings).toMatchObject({
			embeddingPaused: false,
			embeddingBatchSize: 4,
			embeddingPauseMs: 150,
		});
		expect(
			normalizeFolderIndexConfig({
				settings: {
					embeddingPaused: true,
					embeddingBatchSize: 999,
					embeddingPauseMs: -50,
				},
			}).settings,
		).toMatchObject({
			embeddingPaused: true,
			embeddingBatchSize: 16,
			embeddingPauseMs: 25,
		});
		expect(
			normalizeFolderIndexConfig({
				settings: { embeddingBatchSize: NaN, embeddingPauseMs: Infinity },
			}).settings,
		).toMatchObject({ embeddingBatchSize: 4, embeddingPauseMs: 150 });
	});
});
