import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@/types/document-library";
import { findNodeByPath } from "../../utils/tree-utils";
import { useDocumentLibrary } from "../use-document-library";

const mocks = vi.hoisted(() => ({
	getTree: vi.fn(),
	resolveNode: vi.fn(),
	getFolderChildren: vi.fn(),
	readFile: vi.fn(),
	subscribe: vi.fn(),
	t: (key: string) => key,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		initialize: async () => {},
		forceRefresh: () => {},
		getTree: mocks.getTree,
		resolveNode: mocks.resolveNode,
		getFolderChildren: mocks.getFolderChildren,
		readFile: mocks.readFile,
		onFilesystemChanged: mocks.subscribe,
	},
}));
vi.mock("@/main/modules/topics/services/topic-service", () => ({
	topicService: {
		getTopicsWithContentCount: async () => [],
		getFileTopicMap: async () => new Map(),
	},
}));
vi.mock("../use-knowledge-conversion", () => ({
	useKnowledgeConversion: () => ({ convertToKnowledge: vi.fn() }),
}));
vi.mock("@/main/modules/topics/modals", () => ({
	TopicSelectorDialog: () => null,
}));
vi.mock("../../modals", () => ({
	UploadProgressDialog: () => null,
	CreateDocumentDialog: () => null,
}));
vi.mock("../../handlers/pdf-extraction", () => ({ readPDFFile: vi.fn() }));
vi.mock("../../handlers/excel-extraction", () => ({ readExcelFile: vi.fn() }));
vi.mock("../../utils/save-download", () => ({ downloadFolderAsZip: vi.fn() }));

const nodeFolder = (
	path: string,
	children: DocumentTreeNode[] = [],
	isLazy = true,
): DocumentTreeNode => {
	const name = path.split("/").at(-1)!;
	return {
		id: path,
		path,
		name,
		type: "folder",
		children,
		isExpanded: false,
		isLazy,
		folder: {
			id: path,
			path,
			name,
			parentPath: null,
			childCount: children.length,
			createdAt: new Date(0),
			modifiedAt: new Date(0),
		},
	};
};
const target: DocumentTreeNode = {
	id: "/Mapped/deep/capture.png",
	path: "/Mapped/deep/capture.png",
	name: "capture.png",
	type: "file",
	children: [],
	isExpanded: false,
	file: {
		id: "/Mapped/deep/capture.png",
		path: "/Mapped/deep/capture.png",
		name: "capture.png",
		type: "image",
		mimeType: "image/png",
		size: 3,
		createdAt: new Date(0),
		modifiedAt: new Date(0),
	},
};
const native = nodeFolder("/Mapped");
const deep = nodeFolder("/Mapped/deep");
const renderLibrary = async () => {
	const library = renderHook(() => useDocumentLibrary());
	await waitFor(() => expect(library.result.current.loading).toBe(false));
	return library;
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.subscribe.mockReturnValue(() => {});
	mocks.getTree.mockResolvedValue([native]);
	mocks.resolveNode.mockImplementation(async (path: string) =>
		path === target.path ? target : null,
	);
	mocks.getFolderChildren.mockImplementation(async (path: string) =>
		path === native.path ? [deep] : [target],
	);
	mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("opening Files search results", () => {
	it("searches the parent folder when typing from a file viewer", async () => {
		const { result } = await renderLibrary();
		await act(async () => {
			await result.current.handleOpenDocumentByPath(target.path);
		});
		act(() => result.current.handleSearchChange("mobile game"));
		await waitFor(() => expect(result.current.currentPath).toBe(deep.path));
		expect(result.current.isFolderSelected).toBe(true);
		expect(result.current.searchQuery).toBe("mobile game");
	});

	it("opens a source inside unopened mapped folders and keeps it selected after a filesystem refresh", async () => {
		const { result } = await renderLibrary();
		await act(async () => {
			await result.current.handleOpenDocumentByPath(target.path);
		});
		expect(result.current.selectedNode).toBe(target);
		expect(findNodeByPath(result.current.tree, target.path)?.file).toEqual(
			target.file,
		);
		expect(mocks.getFolderChildren.mock.calls.map(([path]) => path)).toEqual([
			native.path,
			deep.path,
		]);
		await act(async () => {
			mocks.subscribe.mock.calls[0][0]({
				operation: "write",
				path: "/elsewhere.txt",
			});
		});
		expect(result.current.selectedNode?.path).toBe(target.path);
		act(() => result.current.handleCloseViewer());
		await waitFor(() => expect(result.current.currentPath).toBe(deep.path));
		expect(result.current.folderContents[0].item.path).toBe(target.path);
	});
	it("opens a folder result that has not been materialized in the navigator", async () => {
		mocks.resolveNode.mockResolvedValue({
			...deep,
			children: [target],
			isLazy: false,
		});
		const { result } = await renderLibrary();
		act(() => result.current.handleOpenFolderByPath(deep.path));
		await waitFor(() => expect(result.current.currentPath).toBe(deep.path));
		expect(result.current.folderContents[0].item.path).toBe(target.path);
	});
	it("does not reopen an old result after the user navigates elsewhere", async () => {
		let resolve!: (node: DocumentTreeNode) => void;
		mocks.resolveNode.mockReturnValue(
			new Promise<DocumentTreeNode>((done) => {
				resolve = done;
			}),
		);
		const { result } = await renderLibrary();
		let opening!: Promise<void>;
		act(() => {
			opening = result.current.handleOpenDocumentByPath(target.path);
		});
		act(() => result.current.handleSelectNode(null));
		await act(async () => {
			resolve(target);
			await opening;
		});
		expect(result.current.currentPath).toBe("/");
		expect(result.current.isFileSelected).toBe(false);
	});
	it("downloads the matching source even when it is absent from the loaded tree", async () => {
		const createObjectURL = vi.fn((_blob: Blob) => "blob:file");
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
		let downloadedName: string | undefined;
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadedName = this.download;
		});
		const { result } = await renderLibrary();
		await act(async () => {
			await result.current.handleDownloadFile(target.path);
		});
		expect(downloadedName).toBe("capture.png");
		expect(createObjectURL.mock.calls[0][0].type).toBe("image/png");
		expect(mocks.readFile).toHaveBeenCalledWith(target.path);
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:file");
	});
	it("reports an open failure without losing the current folder", async () => {
		mocks.resolveNode.mockRejectedValue(new Error("Folder offline"));
		const { result } = await renderLibrary();
		await act(async () => {
			await result.current.handleOpenDocumentByPath(target.path);
		});
		expect(result.current.currentPath).toBe("/");
		expect(result.current.error).toBe("library.openItemError");
	});
});
