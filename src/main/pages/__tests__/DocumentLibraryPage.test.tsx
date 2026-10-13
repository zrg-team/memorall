import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@/types/document-library";
import { DocumentLibraryPage } from "../DocumentLibraryPage";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	openFile: vi.fn(),
	noop: vi.fn(),
	split: true,
}));
const date = new Date(0);
const nameMatch: DocumentTreeNode = {
	id: "/Memory/mobile-game.txt",
	name: "mobile-game.txt",
	path: "/Memory/mobile-game.txt",
	type: "file",
	children: [],
	isExpanded: false,
	file: {
		id: "/Memory/mobile-game.txt",
		name: "mobile-game.txt",
		path: "/Memory/mobile-game.txt",
		type: "text",
		mimeType: "text/plain",
		size: 10,
		createdAt: date,
		modifiedAt: date,
	},
};
const contentMatch: DocumentTreeNode = {
	id: "/Memory/images/capture.png",
	name: "capture.png",
	path: "/Memory/images/capture.png",
	type: "file",
	children: [],
	isExpanded: false,
	file: {
		id: "/Memory/images/capture.png",
		name: "capture.png",
		path: "/Memory/images/capture.png",
		type: "image",
		mimeType: "image/png",
		size: 20,
		createdAt: date,
		modifiedAt: date,
	},
};
const images: DocumentTreeNode = {
	id: "/Memory/images",
	name: "images",
	path: "/Memory/images",
	type: "folder",
	isExpanded: false,
	children: [contentMatch],
	folder: {
		id: "/Memory/images",
		name: "images",
		path: "/Memory/images",
		parentPath: "/Memory",
		childCount: 1,
		createdAt: date,
		modifiedAt: date,
	},
};
const memory: DocumentTreeNode = {
	id: "/Memory",
	name: "Memory",
	path: "/Memory",
	type: "folder",
	isExpanded: true,
	children: [images, nameMatch],
	folder: {
		id: "/Memory",
		name: "Memory",
		path: "/Memory",
		parentPath: null,
		childCount: 2,
		createdAt: date,
		modifiedAt: date,
	},
};
const topics = new Map();
const index = {
	state: {
		folders: [
			{
				path: "/Memory",
				on: ["embeddings"],
				off: [],
				effective: ["embeddings"],
				status: [],
			},
		],
	},
	effectiveAt: () => ["embeddings"],
	entriesOf: () => null,
};
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-router-dom", () => ({
	useLocation: () => ({ pathname: "/files", search: "", state: null }),
	useNavigate: () => mocks.noop,
}));
vi.mock("@/services/folder-index/folder-index-client", () => ({
	folderIndexClient: { request: mocks.request },
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		getFolderChildren: vi.fn(),
		resolveNode: vi.fn(),
	},
}));
vi.mock("@/main/modules/files/hooks/use-document-library", async () => {
	const { useState } = await import("react");
	return {
		useDocumentLibrary: () => {
			const [searchQuery, setSearchQuery] = useState("");
			return {
				tree: [memory],
				workspaceTree: [],
				selectedNode: memory,
				selectedSection: "documents",
				loading: false,
				error: null,
				viewMode: mocks.split ? "list" : "grid",
				searchQuery,
				setSearchQuery,
				handleSearchChange: setSearchQuery,
				topics: [],
				selectedTopicIds: [],
				fileTopicMap: topics,
				currentPath: memory.path,
				isFileSelected: false,
				isFolderSelected: true,
				isWorkspaceSection: false,
				folderContents: [
					{ type: "folder", item: images.folder },
					{ type: "file", item: nameMatch.file },
				],
				handleOpenDocumentByPath: mocks.openFile,
				handleRenameItem: mocks.noop,
				handleDeleteItem: mocks.noop,
				handleDownloadFolder: mocks.noop,
				handleSelectNode: mocks.noop,
				setViewMode: mocks.noop,
				handleTopicFilterChange: mocks.noop,
				handleRemoveTopicFilter: mocks.noop,
				handleClearTopicFilters: mocks.noop,
				handleCreateDocument: mocks.noop,
				triggerFileUpload: mocks.noop,
				handleCreateFolder: mocks.noop,
				handleSelectNodeInActiveTree: mocks.noop,
				handleOpenFolderByPath: mocks.noop,
				handleCloseViewer: mocks.noop,
				handleDownloadFile: mocks.noop,
				handleDownloadSelectedFile: mocks.noop,
				handleManageFileTopic: mocks.noop,
				handleConvertToKnowledge: mocks.noop,
				handleDeleteSelectedFile: mocks.noop,
				handleToggleTopicFilter: mocks.noop,
			};
		},
	};
});
vi.mock("@/main/hooks/use-responsive-workspace-panels", () => ({
	useResponsiveWorkspacePanels: () => ({
		isSplitLayout: mocks.split,
		isCompactSplitLayout: false,
		isSidebarCollapsed: false,
		containerRef: { current: null },
		gridTemplateColumns: "250px 1fr",
		sidebarOverlayWidth: 250,
		expandSidebar: mocks.noop,
		collapseSidebar: mocks.noop,
		handleResizeStart: mocks.noop,
	}),
}));
vi.mock("@/main/modules/files/components/DocumentLibrarySidebar", () => ({
	DocumentLibrarySidebar: () => null,
}));
vi.mock(
	"@/main/modules/files/components/DocumentLibraryCompactNavigator",
	() => ({ DocumentLibraryCompactNavigator: () => null }),
);
vi.mock("@/main/modules/files/components/DocumentBreadcrumb", () => ({
	DocumentBreadcrumb: () => null,
}));
vi.mock("@/main/modules/files/components/DocumentViewer", () => ({
	DocumentViewer: () => null,
}));
vi.mock("@/main/modules/files/hooks/use-source-status", () => ({
	useMultipleSourceStatus: () => topics,
}));
vi.mock("@/main/modules/files/hooks/use-native-mounts", () => ({
	useNativeMounts: () => ({
		supported: false,
		busy: false,
		addRoot: mocks.noop,
	}),
}));
vi.mock("@/main/stores/process-monitor", () => ({
	useProcessMonitor: (select: any) =>
		select({ activeProcesses: new Map(), isProcessing: () => false }),
}));
vi.mock("@/main/modules/files/modals", () => ({
	CreateFolderDialog: () => null,
}));
vi.mock("@/main/modules/topics/components", () => ({
	TopicFilterDropdown: () => null,
	ActiveTopicChips: () => null,
	TopicBadgeList: () => null,
}));
vi.mock("@/main/modules/files/folder-index/FolderIndexContext", () => ({
	useFolderIndex: () => index,
}));
vi.mock("@/main/modules/files/folder-index", () => ({
	FolderIndexProvider: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
	FolderIndexBar: ({ fileCount }: { fileCount: number }) => (
		<span data-testid="folder-file-count">{fileCount}</span>
	),
	FolderIndexCardDialog: () => null,
	FolderIndexesDialog: () => null,
	FolderIndexGraphDialog: () => null,
	FolderIndexMappedConfirm: () => null,
	FolderIndexesButton: () => null,
	FolderIndexBadges: () => null,
	FolderIndexMenuItems: () => null,
	IndexTypeBadge: ({ label }: { label: string }) => <span>{label}</span>,
	useFolderIndex: () => index,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.split = true;
	mocks.request.mockResolvedValue({
		hits: [
			{
				id: `${contentMatch.path}#0`,
				path: contentMatch.path,
				title: contentMatch.name,
				kind: "image",
				location: {},
				text: "A screenshot of a mobile game.",
				score: 0.9,
			},
		],
		searched: 1,
		truncated: false,
	});
});
afterEach(cleanup);

describe("Files search input", () => {
	it.each([true, false])(
		"searches names and embedded content and opens the source in split layout %s",
		async (split) => {
			mocks.split = split;
			render(<DocumentLibraryPage />);
			const input = screen.getByRole("searchbox", {
				name: "library.searchPlaceholder",
			});
			expect(screen.getByText("images")).toBeInTheDocument();
			fireEvent.change(input, { target: { value: "mobile game" } });
			expect(screen.queryByText("images")).not.toBeInTheDocument();
			expect(screen.getByText("mobile-game.txt")).toBeInTheDocument();
			expect(await screen.findByText("capture.png")).toBeInTheDocument();
			expect(screen.getByText(contentMatch.path)).toBeInTheDocument();
			expect(
				screen.getByText("A screenshot of a mobile game."),
			).toBeInTheDocument();
			expect(screen.getByText("library.contentMatch")).toBeInTheDocument();
			expect(screen.getByTestId("folder-file-count")).toHaveTextContent("1");
			expect(mocks.request).toHaveBeenCalledWith("embedding.search", {
				query: "mobile game",
				folder: "/Memory",
				limit: 50,
			});
			fireEvent.click(screen.getByText("capture.png"));
			expect(mocks.openFile).toHaveBeenCalledWith(contentMatch.path);
			fireEvent.keyDown(input, { key: "Escape" });
			expect(input).toHaveValue("");
			expect(screen.getByText("images")).toBeInTheDocument();
			expect(screen.queryByText("capture.png")).not.toBeInTheDocument();
		},
	);
	it("shows search failure and no matches without describing the folder as empty", async () => {
		mocks.request.mockRejectedValueOnce(
			new Error("Embedding model unavailable"),
		);
		render(<DocumentLibraryPage />);
		fireEvent.change(screen.getByRole("searchbox"), {
			target: { value: "unmatched" },
		});
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"library.searchError",
		);
		expect(screen.getByText("library.noSearchResults")).toBeInTheDocument();
		expect(screen.queryByText("list.emptyFolder")).not.toBeInTheDocument();
	});
});
