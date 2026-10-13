import React, { memo, useMemo, useCallback } from "react";
import { Folder, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentList } from "./DocumentList";
import { DocumentViewer } from "./DocumentViewer";
import { useMultipleSourceStatus } from "../hooks/use-source-status";
import { useDocumentSearch } from "../hooks/use-document-search";
import { FolderIndexBar } from "../folder-index";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
	DocumentFile,
	DocumentFolder,
} from "@/types/document-library";
import type { Topic } from "@/services/database/entities/topics";

// Stable empty map to avoid creating new Map() on every render
const EMPTY_TOPIC_MAP = new Map<string, Topic[]>();
const EMPTY_TOPIC_IDS: string[] = [];
const EMPTY_TOPICS: Topic[] = [];

interface DocumentLibraryContentProps {
	/** The open folder's library path, for its index. */
	currentPath?: string;
	selectedNode: DocumentTreeNode | null;
	isFileSelected: boolean;
	isFolderSelected: boolean;
	isWorkspaceSection: boolean;
	folderContents: DocumentLibraryItem[];
	searchQuery?: string;
	viewMode: "grid" | "list";
	fileTopicMap: Map<string, Topic[]>;
	selectedTopicIds: string[];
	compact?: boolean;
	compactNavigatorToggle?: React.ReactNode;
	/** Navigate to a node by id in the active tree */
	onSelectNodeById: (id: string) => void;
	onOpenFileByPath: (path: string) => void;
	/** Navigate to a folder by path in the active tree */
	onOpenFolderByPath: (path: string) => void;
	/** Close the file viewer and return to parent folder */
	onCloseViewer: () => void;
	onDeleteItem: (item: DocumentLibraryItem) => void;
	onRenameItem: (item: DocumentLibraryItem, newName: string) => void;
	onDownloadFile: (id: string) => void;
	onDownloadFolder?: (folderPath: string) => void;
	onDownloadSelectedFile: () => void;
	onManageTopics: (file: DocumentFile) => void;
	onConvertToKnowledge: (file: DocumentFile) => void;
	onDeleteSelectedFile: () => void;
	onToggleTopicFilter: (id: string) => void;
}

export const DocumentLibraryContent = memo(function DocumentLibraryContent({
	currentPath = "/",
	selectedNode,
	isFileSelected,
	isFolderSelected,
	isWorkspaceSection,
	folderContents,
	searchQuery = "",
	viewMode,
	fileTopicMap,
	selectedTopicIds,
	compactNavigatorToggle,
	onSelectNodeById,
	onOpenFileByPath,
	onOpenFolderByPath,
	onCloseViewer,
	onDeleteItem,
	onRenameItem,
	onDownloadFile,
	onDownloadFolder,
	onDownloadSelectedFile,
	onManageTopics,
	onConvertToKnowledge,
	onDeleteSelectedFile,
	onToggleTopicFilter,
	compact = false,
}: DocumentLibraryContentProps) {
	const { t } = useTranslation("documents");
	const search = useDocumentSearch({
		folder: isFolderSelected ? selectedNode : null,
		folderContents,
		searchQuery,
		fileTopicMap,
		selectedTopicIds,
	});

	// Move source-status tracking here so it doesn't run in the page root
	const filePaths = useMemo(
		() =>
			search.items
				.filter((item) => item.type === "file")
				.map((item) => item.item.path),
		[search.items],
	);
	const sourceStatusMap = useMultipleSourceStatus(filePaths);

	// Stable select/open callbacks (look up node in active tree via parent handler)
	const handleSelectItem = useCallback(
		(item: DocumentLibraryItem) => {
			if (search.active && item.type === "file") {
				onOpenFileByPath(item.item.path);
			} else {
				onSelectNodeById(item.item.id);
			}
		},
		[onSelectNodeById, onOpenFileByPath, search.active],
	);

	const handleOpenFolder = useCallback(
		(path: string) => {
			onOpenFolderByPath(path);
		},
		[onOpenFolderByPath],
	);

	const handleDownloadFolder = useCallback(
		(folder: DocumentFolder) => onDownloadFolder?.(folder.path),
		[onDownloadFolder],
	);

	// For workspace section — pass undefined to hide topic/convert actions
	const effectiveManageTopics = isWorkspaceSection ? undefined : onManageTopics;
	const effectiveConvertToKnowledge = isWorkspaceSection
		? undefined
		: onConvertToKnowledge;
	const effectiveDownloadFile = isWorkspaceSection ? undefined : onDownloadFile;
	const effectiveFileTopicMap = isWorkspaceSection
		? EMPTY_TOPIC_MAP
		: fileTopicMap;
	const effectiveSelectedTopicIds = isWorkspaceSection
		? EMPTY_TOPIC_IDS
		: selectedTopicIds;
	const effectiveOnTopicClick = isWorkspaceSection
		? undefined
		: onToggleTopicFilter;

	if (isFolderSelected) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				{!isWorkspaceSection && (
					<FolderIndexBar
						folderPath={currentPath}
						fileCount={
							folderContents.filter((item) => item.type === "file").length
						}
					/>
				)}
				{search.active && (
					<div
						role="status"
						className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"
					>
						{search.busy && (
							<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
						)}
						{t(search.busy ? "library.searching" : "library.searchResults", {
							count: search.items.length,
						})}
					</div>
				)}
				{search.error && (
					<p
						role="alert"
						title={search.error}
						className="px-4 pb-2 text-xs text-destructive"
					>
						{t("library.searchError")}
					</p>
				)}
				<div className="min-h-0 flex-1">
					<DocumentList
						folderPath={isWorkspaceSection ? undefined : currentPath}
						items={search.items}
						searchActive={search.active}
						searchBusy={search.busy}
						searchHits={search.hits}
						selectedItem={null}
						sourceStatusMap={sourceStatusMap}
						onSelectItem={handleSelectItem}
						onOpenFolder={handleOpenFolder}
						onDeleteItem={onDeleteItem}
						onRenameItem={onRenameItem}
						onDownloadFile={effectiveDownloadFile}
						onDownloadFolder={
							onDownloadFolder ? handleDownloadFolder : undefined
						}
						onManageTopics={effectiveManageTopics}
						onConvertToKnowledge={effectiveConvertToKnowledge}
						fileTopicMap={effectiveFileTopicMap}
						selectedTopicIds={effectiveSelectedTopicIds}
						onTopicClick={effectiveOnTopicClick}
						viewMode={viewMode}
					/>
				</div>
			</div>
		);
	}

	if (isFileSelected && selectedNode?.file) {
		return (
			<DocumentViewer
				file={selectedNode.file}
				isWorkspaceFile={isWorkspaceSection}
				compact={compact}
				compactNavigatorToggle={compactNavigatorToggle}
				onClose={onCloseViewer}
				onDelete={onDeleteSelectedFile}
				onDownload={onDownloadSelectedFile}
				onManageTopics={effectiveManageTopics}
				onConvertToKnowledge={effectiveConvertToKnowledge}
				fileTopics={
					isWorkspaceSection
						? EMPTY_TOPICS
						: (fileTopicMap.get(selectedNode.file.path) ?? EMPTY_TOPICS)
				}
				selectedTopicIds={effectiveSelectedTopicIds}
				onTopicClick={effectiveOnTopicClick}
			/>
		);
	}

	return (
		<div className="flex items-center justify-center h-full text-muted-foreground flex-1">
			<div className="text-center">
				<Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
				<p className="text-sm">{t("library.emptyState")}</p>
			</div>
		</div>
	);
});
