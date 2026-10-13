import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@/services/database/entities/topics";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
} from "@/types/document-library";
import type {
	EmbeddingSearchHit,
	EmbeddingSearchResult,
} from "@/services/folder-index/embedding/types";
import {
	emptyFolderIndexConfig,
	effectiveIndexTypes,
} from "@/services/folder-index/index-config";
import type { FolderIndexRule } from "@/services/folder-index/types";
import { useDocumentSearch } from "../use-document-search";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	getFolderChildren: vi.fn(),
	resolveNode: vi.fn(),
	index: null as any,
}));
vi.mock("@/services/folder-index/folder-index-client", () => ({
	folderIndexClient: { request: mocks.request },
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		getFolderChildren: mocks.getFolderChildren,
		resolveNode: mocks.resolveNode,
	},
}));
vi.mock("../../folder-index/FolderIndexContext", () => ({
	useFolderIndex: () => mocks.index,
}));

const file = (path: string): DocumentTreeNode => {
	const name = path.split("/").at(-1)!;
	return {
		id: path,
		name,
		path,
		type: "file",
		children: [],
		isExpanded: false,
		file: {
			id: path,
			name,
			path,
			type: "text",
			mimeType: "text/plain",
			size: 8,
			createdAt: new Date(0),
			modifiedAt: new Date(0),
		},
	};
};
const folder = (
	path: string,
	children: DocumentTreeNode[] = [],
	isLazy = false,
): DocumentTreeNode => {
	const name = path.split("/").at(-1)!;
	return {
		id: path,
		name,
		path,
		type: "folder",
		children,
		isLazy,
		isExpanded: false,
		folder: {
			id: path,
			name,
			path,
			parentPath: null,
			childCount: children.length,
			createdAt: new Date(0),
			modifiedAt: new Date(0),
		},
	};
};
const hit = (
	path: string,
	score = 0.8,
	id = `${path}#0`,
): EmbeddingSearchHit => ({
	path,
	score,
	id,
	title: path.split("/").at(-1)!,
	kind: "text",
	location: {},
	text: "A mobile game.",
});
const resultOf = (hits: EmbeddingSearchHit[]): EmbeddingSearchResult => ({
	hits,
	searched: hits.length,
	truncated: false,
});
const indexWith = (
	rules: Record<string, FolderIndexRule>,
	updatedAt = "2026-10-12T00:00:00Z",
) => {
	const config = { ...emptyFolderIndexConfig(), folders: rules };
	return {
		effectiveAt: (path: string) => effectiveIndexTypes(config, path),
		state: {
			folders: Object.entries(rules).map(([path, rule]) => ({
				path,
				on: rule.on ?? [],
				off: rule.off ?? [],
				effective: effectiveIndexTypes(config, path),
				status: [
					{ typeId: "embeddings", entries: 1, files: 1, chunks: 2, updatedAt },
				],
			})),
		},
	};
};
const mobile = file("/Memory/mobile-game.txt");
const notes = file("/Memory/images/notes.txt");
const memory = folder("/Memory", [
	mobile,
	folder("/Memory/images", [notes]),
	file("/Memory/unrelated.txt"),
]);
const options = {
	folder: memory,
	folderContents: memory.children.map(
		(node): DocumentLibraryItem =>
			node.type === "file"
				? { type: "file", item: node.file! }
				: { type: "folder", item: node.folder! },
	),
	searchQuery: "mobile game",
	fileTopicMap: new Map<string, Topic[]>(),
	selectedTopicIds: [] as string[],
};
const paths = (items: DocumentLibraryItem[]) =>
	items.map((item) => item.item.path);
const search = (overrides: Partial<typeof options> = {}) =>
	renderHook((props) => useDocumentSearch(props), {
		initialProps: { ...options, ...overrides },
	});
const tick = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});
const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	mocks.index = null;
	mocks.resolveNode.mockResolvedValue(null);
	mocks.getFolderChildren.mockResolvedValue([]);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("Files search", () => {
	it("matches names and descendant paths immediately, ignoring case and extra spaces", async () => {
		const { result, rerender } = search({ searchQuery: "  MOBILE  game  " });
		expect(paths(result.current.items)).toEqual([mobile.path]);
		expect(result.current.busy).toBe(false);
		rerender({ ...options, searchQuery: "IMAGES notes" });
		expect(paths(result.current.items)).toEqual([notes.path]);
		await tick();
		expect(mocks.request).not.toHaveBeenCalled();
	});
	it("restores the original folder contents when cleared and keeps results stable between renders", () => {
		const { result, rerender } = search();
		const items = result.current.items;
		rerender({ ...options });
		expect(result.current.items).toBe(items);
		rerender({ ...options, searchQuery: "  " });
		expect(result.current.active).toBe(false);
		expect(result.current.items).toBe(options.folderContents);
	});
	it("merges embedding matches with names, ranks and deduplicates chunks, and ignores stale or out-of-scope sources", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		const mapped = file("/Memory/mapped/screenshot.txt");
		mocks.resolveNode.mockImplementation(async (path: string) =>
			path === mapped.path ? mapped : null,
		);
		mocks.request.mockResolvedValue(
			resultOf([
				hit(notes.path, 0.5),
				hit(mapped.path, 0.9),
				hit(notes.path, 0.8, "best"),
				hit(mobile.path),
				hit("/Memory/deleted.txt"),
				hit("/Memory-other/private.txt"),
			]),
		);
		const { result } = search();
		expect(result.current.busy).toBe(true);
		expect(paths(result.current.items)).toEqual([mobile.path]);
		await tick();
		expect(mocks.request).toHaveBeenCalledWith("embedding.search", {
			query: "mobile game",
			folder: "/Memory",
			limit: 50,
		});
		expect(paths(result.current.items)).toEqual([
			mobile.path,
			mapped.path,
			notes.path,
		]);
		expect(result.current.hits.get(notes.path)?.id).toBe("best");
		expect(mocks.resolveNode).not.toHaveBeenCalledWith(notes.path);
		expect(mocks.resolveNode).not.toHaveBeenCalledWith(
			"/Memory-other/private.txt",
		);
		expect(result.current.busy).toBe(false);
	});
	it("searches a descendant embedding index from its parent folder", async () => {
		mocks.index = indexWith({ "/Memory/images": { on: ["embeddings"] } });
		mocks.request.mockResolvedValue(resultOf([hit(notes.path)]));
		const { result } = search();
		await tick();
		expect(paths(result.current.items)).toEqual([mobile.path, notes.path]);
		expect(mocks.request).toHaveBeenCalledTimes(1);
	});
	it.each<Record<string, FolderIndexRule>>([
		{ "/Elsewhere": { on: ["embeddings"] } },
		{ "/": { on: ["embeddings"] }, "/Memory": { off: ["embeddings"] } },
	])(
		"skips inference when embeddings are outside the scope or disabled",
		async (rules) => {
			mocks.index = indexWith(rules);
			const { result } = search();
			await tick();
			expect(mocks.request).not.toHaveBeenCalled();
			expect(paths(result.current.items)).toEqual([mobile.path]);
		},
	);
	it("applies topic filters to name and semantic matches", async () => {
		mocks.index = indexWith({ "/": { on: ["embeddings"] } });
		mocks.request.mockResolvedValue(
			resultOf([hit(notes.path), hit(mobile.path)]),
		);
		const { result } = search({
			selectedTopicIds: ["memory-topic"],
			fileTopicMap: new Map([[notes.path, [{ id: "memory-topic" } as Topic]]]),
		});
		await tick();
		expect(paths(result.current.items)).toEqual([notes.path]);
	});
	it("debounces typing and discards responses from an earlier query", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		const previous = deferred<EmbeddingSearchResult>();
		mocks.request
			.mockReturnValueOnce(previous.promise)
			.mockResolvedValueOnce(resultOf([hit(notes.path)]));
		const { result, rerender } = search({ searchQuery: "m" });
		rerender({ ...options, searchQuery: "mobile" });
		await tick();
		rerender({ ...options, searchQuery: "piano" });
		expect(paths(result.current.items)).toEqual([]);
		await tick();
		await act(async () => {
			previous.resolve(resultOf([hit(mobile.path)]));
		});
		expect(paths(result.current.items)).toEqual([notes.path]);
		expect(
			mocks.request.mock.calls.map(([, payload]) => payload.query),
		).toEqual(["mobile", "piano"]);
	});
	it("discards pending search results after clearing or navigating to another folder", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		const previous = deferred<EmbeddingSearchResult>();
		mocks.request.mockReturnValueOnce(previous.promise);
		const { result, rerender } = search();
		await tick();
		rerender({ ...options, searchQuery: "" });
		await act(async () => {
			previous.resolve(resultOf([hit(notes.path)]));
		});
		expect(result.current.items).toBe(options.folderContents);
		expect(result.current.hits.size).toBe(0);
		const pending = deferred<EmbeddingSearchResult>();
		mocks.request.mockReturnValueOnce(pending.promise);
		rerender({ ...options });
		await tick();
		rerender({ ...options, folder: folder("/Other"), folderContents: [] });
		await act(async () => {
			pending.resolve(resultOf([hit(notes.path)]));
		});
		expect(result.current.items).toEqual([]);
		expect(result.current.busy).toBe(false);
	});
	it("keeps name search working when content search fails or has no indexed chunks", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		mocks.request
			.mockRejectedValueOnce(new Error("Model unavailable"))
			.mockResolvedValueOnce(resultOf([]));
		const { result, rerender } = search();
		await tick();
		expect(paths(result.current.items)).toEqual([mobile.path]);
		expect(result.current.error).toBe("Model unavailable");
		expect(result.current.busy).toBe(false);
		rerender({ ...options, searchQuery: "mobile" });
		await tick();
		expect(result.current.error).toBeNull();
		expect(paths(result.current.items)).toEqual([mobile.path]);
	});
	it("refreshes after an index rebuild without repeating inference for unchanged polling", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		mocks.request.mockResolvedValue(resultOf([]));
		const { result, rerender } = search();
		await tick();
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		rerender({ ...options });
		await tick();
		expect(mocks.request).toHaveBeenCalledTimes(1);
		mocks.index = indexWith(
			{ "/Memory": { on: ["embeddings"] } },
			"2026-10-12T00:05:00Z",
		);
		mocks.request.mockResolvedValue(resultOf([hit(notes.path)]));
		rerender({ ...options });
		await tick();
		expect(mocks.request).toHaveBeenCalledTimes(2);
		expect(paths(result.current.items)).toEqual([mobile.path, notes.path]);
	});
	it("finds names in unopened mapped subfolders and stops walking when the query is cleared", async () => {
		const native = folder("/Memory/native", [], true);
		const nested = folder("/Memory/native/deep", [], true);
		const nativeFile = file("/Memory/native/deep/mobile-game.txt");
		mocks.getFolderChildren.mockImplementation(async (path: string) =>
			path === native.path ? [nested] : [nativeFile],
		);
		const root = folder("/Memory", [native]);
		const props = {
			...options,
			folder: root,
			folderContents: [{ type: "folder" as const, item: native.folder! }],
		};
		const { result, rerender } = search(props);
		await tick();
		expect(paths(result.current.items)).toEqual([nativeFile.path]);
		expect(mocks.getFolderChildren.mock.calls.map(([path]) => path)).toEqual([
			native.path,
			nested.path,
		]);
		mocks.getFolderChildren.mockClear();
		const listing = deferred<DocumentTreeNode[]>();
		mocks.getFolderChildren.mockReturnValueOnce(listing.promise);
		rerender({ ...props, searchQuery: "piano" });
		await tick();
		rerender({ ...props, searchQuery: "" });
		await act(async () => {
			listing.resolve([nested]);
		});
		expect(mocks.getFolderChildren).toHaveBeenCalledTimes(1);
		expect(result.current.items).toBe(props.folderContents);
	});
	it("keeps results and does not search again when a filesystem change rebuilds the folder", async () => {
		mocks.index = indexWith({ "/Memory": { on: ["embeddings"] } });
		mocks.request.mockResolvedValue(resultOf([hit(notes.path)]));
		const { result, rerender } = search();
		await tick();
		expect(paths(result.current.items)).toEqual([mobile.path, notes.path]);

		// The same folder as a new node, as every rebuild of the tree hands it.
		const rebuilt = folder("/Memory", [
			...memory.children,
			file("/Memory/mobile-game-2.txt"),
		]);
		rerender({ ...options, folder: rebuilt });
		expect(paths(result.current.items)).toEqual([
			mobile.path,
			"/Memory/mobile-game-2.txt",
			notes.path,
		]);
		expect(result.current.busy).toBe(false);
		await tick();
		expect(mocks.request).toHaveBeenCalledTimes(1);
	});
	it("reads a bounded number of unopened folders per search", async () => {
		const lazy = (path: string) => folder(path, [], true);
		let next = 0;
		mocks.getFolderChildren.mockImplementation(async () => [
			lazy(`/Memory/deep/${++next}`),
			lazy(`/Memory/deep/${++next}`),
		]);
		const root = folder("/Memory", [lazy("/Memory/deep")]);
		search({ folder: root, folderContents: [], searchQuery: "anything" });
		await tick();
		await act(async () => {
			await vi.runAllTimersAsync();
		});
		expect(mocks.getFolderChildren).toHaveBeenCalledTimes(200);
	});
});
