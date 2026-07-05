import React, { memo, useMemo, useCallback } from "react";
import { Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentList } from "./DocumentList";
import { DocumentViewer } from "./DocumentViewer";
import { useMultipleSourceStatus } from "../hooks/use-source-status";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
	DocumentFile,
} from "@/types/document-library";
import type { Topic } from "@/services/database/entities/topics";

// Stable empty map to avoid creating new Map() on every render
const EMPTY_TOPIC_MAP = new Map<string, Topic[]>();
const EMPTY_TOPIC_IDS: string[] = [];

interface DocumentLibraryContentProps {
	selectedNode: DocumentTreeNode | null;
	isFileSelected: boolean;
	isFolderSelected: boolean;
	isWorkspaceSection: boolean;
	folderContents: DocumentLibraryItem[];
	viewMode: "grid" | "list";
	fileTopicMap: Map<string, Topic[]>;
	selectedTopicIds: string[];
	compact?: boolean;
	compactNavigatorToggle?: React.ReactNode;
	/** Navigate to a node by id in the active tree */
	onSelectNodeById: (id: string) => void;
	/** Navigate to a folder by path in the active tree */
	onOpenFolderByPath: (path: string) => void;
	/** Close the file viewer and return to parent folder */
	onCloseViewer: () => void;
	onDeleteItem: (item: DocumentLibraryItem) => void;
	onRenameItem: (item: DocumentLibraryItem, newName: string) => void;
	onDownloadFile: (id: string) => void;
	onDownloadSelectedFile: () => void;
	onManageTopics: (file: DocumentFile) => void;
	onConvertToKnowledge: (file: DocumentFile) => void;
	onDeleteSelectedFile: () => void;
	onToggleTopicFilter: (id: string) => void;
}

export const DocumentLibraryContent = memo(function DocumentLibraryContent({
	selectedNode,
	isFileSelected,
	isFolderSelected,
	isWorkspaceSection,
	folderContents,
	viewMode,
	fileTopicMap,
	selectedTopicIds,
	compactNavigatorToggle,
	onSelectNodeById,
	onOpenFolderByPath,
	onCloseViewer,
	onDeleteItem,
	onRenameItem,
	onDownloadFile,
	onDownloadSelectedFile,
	onManageTopics,
	onConvertToKnowledge,
	onDeleteSelectedFile,
	onToggleTopicFilter,
	compact = false,
}: DocumentLibraryContentProps) {
	const { t } = useTranslation("documents");

	// Move source-status tracking here so it doesn't run in the page root
	const filePaths = useMemo(
		() =>
			folderContents
				.filter((item) => item.type === "file")
				.map((item) => item.item.path),
		[folderContents],
	);
	const sourceStatusMap = useMultipleSourceStatus(filePaths);

	// Stable select/open callbacks (look up node in active tree via parent handler)
	const handleSelectItem = useCallback(
		(item: DocumentLibraryItem) => {
			onSelectNodeById(item.item.id);
		},
		[onSelectNodeById],
	);

	const handleOpenFolder = useCallback(
		(path: string) => {
			onOpenFolderByPath(path);
		},
		[onOpenFolderByPath],
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
			<DocumentList
				items={folderContents}
				selectedItem={null}
				sourceStatusMap={sourceStatusMap}
				onSelectItem={handleSelectItem}
				onOpenFolder={handleOpenFolder}
				onDeleteItem={onDeleteItem}
				onRenameItem={onRenameItem}
				onDownloadFile={effectiveDownloadFile}
				onManageTopics={effectiveManageTopics}
				onConvertToKnowledge={effectiveConvertToKnowledge}
				fileTopicMap={effectiveFileTopicMap}
				selectedTopicIds={effectiveSelectedTopicIds}
				onTopicClick={effectiveOnTopicClick}
				viewMode={viewMode}
			/>
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
						? []
						: (fileTopicMap.get(selectedNode.file.path) ?? [])
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
