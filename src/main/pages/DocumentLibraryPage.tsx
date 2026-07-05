import React, { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
	FileText,
	FolderTree,
	Loader2,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { useDocumentLibrary } from "@/main/modules/files/hooks/use-document-library";
import { DocumentLibraryHeader } from "@/main/modules/files/components/DocumentLibraryHeader";
import { DocumentLibrarySidebar } from "@/main/modules/files/components/DocumentLibrarySidebar";
import { DocumentLibraryContent } from "@/main/modules/files/components/DocumentLibraryContent";
import { DocumentLibraryCompactNavigator } from "@/main/modules/files/components/DocumentLibraryCompactNavigator";
import { Button } from "@/main/components/ui/button";
import { useResponsiveWorkspacePanels } from "@/main/hooks/use-responsive-workspace-panels";
import { WorkspaceCollapsedSidebarItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarItem";
import type { DocumentTreeNode } from "@/types/document-library";

const PANEL_STORAGE_KEY = "memorall.documents.workspace-panels.v2";

export const DocumentLibraryPage: React.FC = () => {
	const { t } = useTranslation("documents");
	const location = useLocation();
	const navigate = useNavigate();
	const lib = useDocumentLibrary();
	const [compactNavigatorCollapsed, setCompactNavigatorCollapsed] =
		React.useState(false);
	const {
		collapseSidebar,
		containerRef,
		expandSidebar,
		gridTemplateColumns,
		handleResizeStart,
		isCompactSplitLayout,
		isSidebarCollapsed,
		isSplitLayout,
		sidebarOverlayWidth,
	} = useResponsiveWorkspacePanels({
		storageKey: PANEL_STORAGE_KEY,
		splitBreakpoint: 700,
		collapseBreakpoint: 1180,
	});
	const activeTree = lib.tree;
	const compactNavigatorExpandButton = compactNavigatorCollapsed ? (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => setCompactNavigatorCollapsed(false)}
			className="h-8 w-8 flex-shrink-0 p-0"
			title={t("navigator.expand")}
			aria-label={t("navigator.expand")}
		>
			<PanelLeftOpen className="h-4 w-4" />
		</Button>
	) : null;
	const homeOptions = undefined;

	React.useEffect(() => {
		const documentPath = (
			location.state as { openDocumentPath?: string } | null
		)?.openDocumentPath;
		if (!documentPath || lib.loading) return;
		lib.handleOpenDocumentByPath(documentPath);
		navigate(`${location.pathname}${location.search}`, {
			replace: true,
			state: null,
		});
	}, [
		lib.loading,
		lib.handleOpenDocumentByPath,
		location.pathname,
		location.search,
		location.state,
		navigate,
	]);

	React.useEffect(() => {
		if (isSplitLayout) setCompactNavigatorCollapsed(false);
	}, [isSplitLayout]);

	const handleTreeRename = useCallback(
		(node: DocumentTreeNode, newName: string) => {
			if (node.type === "file" && node.file) {
				lib.handleRenameItem({ type: "file", item: node.file }, newName);
			} else if (node.type === "folder" && node.folder) {
				lib.handleRenameItem({ type: "folder", item: node.folder }, newName);
			}
		},
		[lib],
	);

	const handleTreeDelete = useCallback(
		(node: DocumentTreeNode) => {
			if (node.type === "file" && node.file) {
				lib.handleDeleteItem({ type: "file", item: node.file });
			} else if (node.type === "folder" && node.folder) {
				lib.handleDeleteItem({ type: "folder", item: node.folder });
			}
		},
		[lib],
	);

	if (lib.loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
			{isSplitLayout ? (
				<div
					ref={containerRef}
					className="grid min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
					style={{
						gridTemplateColumns,
					}}
				>
					<div
						className={`relative z-20 min-h-0 border-r bg-background ${
							isSidebarCollapsed ||
							(isCompactSplitLayout && !isSidebarCollapsed)
								? "overflow-visible"
								: "overflow-hidden"
						}`}
					>
						{isSidebarCollapsed ? (
							<div className="flex h-full flex-col items-center gap-2 py-3">
								<WorkspaceCollapsedSidebarItem
									icon={<PanelLeftOpen className="h-4 w-4" />}
									label={t("navigator.expand")}
									onClick={expandSidebar}
									className="border border-input bg-background hover:bg-accent"
								/>
								<div className="mt-2 flex flex-col gap-2">
									<WorkspaceCollapsedSidebarItem
										icon={<FileText className="h-5 w-5" />}
										label={t("title")}
										active={lib.selectedSection === "documents"}
										onClick={() => {
											expandSidebar();
											lib.handleSelectDocumentsSection();
										}}
									/>
									{lib.workspaceTree.length > 0 ? (
										<WorkspaceCollapsedSidebarItem
											icon={<FolderTree className="h-5 w-5" />}
											label={t("sidebar.workspace")}
											active={lib.selectedSection === "workspace"}
											onClick={() => {
												expandSidebar();
												lib.handleSelectWorkspaceSection();
											}}
										/>
									) : null}
								</div>
							</div>
						) : (
							<div
								className={
									isCompactSplitLayout
										? "absolute left-0 top-0 flex h-full min-h-0 flex-col overflow-hidden border-r bg-background shadow-2xl"
										: "h-full min-h-0 overflow-hidden"
								}
								style={
									isCompactSplitLayout
										? { width: sidebarOverlayWidth }
										: undefined
								}
							>
								<DocumentLibrarySidebar
									tree={lib.tree}
									workspaceTree={lib.workspaceTree}
									selectedSection={lib.selectedSection}
									selectedNodeId={lib.selectedNode?.id ?? null}
									docsTitle={t("title")}
									collapseButton={
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											onClick={collapseSidebar}
											aria-label={t("navigator.collapse")}
											title={t("navigator.collapse")}
										>
											<PanelLeftClose className="h-4 w-4" />
										</Button>
									}
									onSelectDocumentsRoot={lib.handleSelectDocumentsSection}
									onSelectDocNode={lib.handleSelectDocNode}
									onSelectWorkspaceNode={lib.handleSelectWorkspaceNode}
									onSelectWorkspaceRoot={lib.handleSelectWorkspaceSection}
									onToggleExpand={lib.handleToggleExpand}
									onToggleExpandWorkspace={lib.handleToggleExpandWorkspace}
									onMove={lib.handleMove}
									onRenameNode={handleTreeRename}
									onDeleteNode={handleTreeDelete}
								/>
							</div>
						)}
					</div>
					<div
						role="separator"
						aria-orientation="vertical"
						className={
							!isSidebarCollapsed && !isCompactSplitLayout
								? "group relative z-10 -mx-[5px] flex w-3 cursor-col-resize items-center justify-center bg-transparent"
								: "hidden"
						}
						onMouseDown={handleResizeStart}
					>
						<div className="h-full w-px bg-border/80 transition-all group-hover:w-[2px] group-hover:bg-foreground/20" />
					</div>
					<div className="min-w-0 flex-1 overflow-hidden">
						<div className="flex h-full min-h-0 flex-col">
							<DocumentLibraryHeader
								currentPath={lib.currentPath}
								activeTree={activeTree}
								homeTitle={t("title")}
								isWorkspaceSection={lib.isWorkspaceSection}
								viewMode={lib.viewMode}
								searchQuery={lib.searchQuery}
								topics={lib.topics}
								selectedTopicIds={lib.selectedTopicIds}
								error={lib.error}
								onNavigate={lib.handleSelectNode}
								homeOptions={homeOptions}
								onViewModeChange={lib.setViewMode}
								onSearchChange={lib.setSearchQuery}
								onTopicFilterChange={lib.handleTopicFilterChange}
								onRemoveTopicFilter={lib.handleRemoveTopicFilter}
								onClearTopicFilters={lib.handleClearTopicFilters}
								onCreateDocument={lib.handleCreateDocument}
								onTriggerUpload={lib.triggerFileUpload}
								onCreateFolder={lib.handleCreateFolder}
							/>
							<div className="min-h-0 flex-1 overflow-hidden">
								<DocumentLibraryContent
									selectedNode={lib.selectedNode}
									isFileSelected={lib.isFileSelected}
									isFolderSelected={lib.isFolderSelected}
									isWorkspaceSection={lib.isWorkspaceSection}
									folderContents={lib.folderContents}
									viewMode={lib.viewMode}
									fileTopicMap={lib.fileTopicMap}
									selectedTopicIds={lib.selectedTopicIds}
									onSelectNodeById={lib.handleSelectNodeInActiveTree}
									onOpenFolderByPath={lib.handleOpenFolderByPath}
									onCloseViewer={lib.handleCloseViewer}
									onDeleteItem={lib.handleDeleteItem}
									onRenameItem={lib.handleRenameItem}
									onDownloadFile={lib.handleDownloadFile}
									onDownloadSelectedFile={lib.handleDownloadSelectedFile}
									onManageTopics={lib.handleManageFileTopic}
									onConvertToKnowledge={lib.handleConvertToKnowledge}
									onDeleteSelectedFile={lib.handleDeleteSelectedFile}
									onToggleTopicFilter={lib.handleToggleTopicFilter}
								/>
							</div>
						</div>
					</div>
				</div>
			) : (
				<>
					<DocumentLibraryHeader
						currentPath={lib.currentPath}
						activeTree={activeTree}
						homeTitle={t("title")}
						isWorkspaceSection={lib.isWorkspaceSection}
						compact
						compactLeading={
							lib.isFileSelected ? null : compactNavigatorExpandButton
						}
						viewMode={lib.viewMode}
						searchQuery={lib.searchQuery}
						topics={lib.topics}
						selectedTopicIds={lib.selectedTopicIds}
						error={lib.error}
						onNavigate={lib.handleSelectNode}
						homeOptions={homeOptions}
						onViewModeChange={lib.setViewMode}
						onSearchChange={lib.setSearchQuery}
						onTopicFilterChange={lib.handleTopicFilterChange}
						onRemoveTopicFilter={lib.handleRemoveTopicFilter}
						onClearTopicFilters={lib.handleClearTopicFilters}
						onCreateDocument={lib.handleCreateDocument}
						onTriggerUpload={lib.triggerFileUpload}
						onCreateFolder={lib.handleCreateFolder}
					/>
					<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
						<DocumentLibraryCompactNavigator
							tree={lib.tree}
							workspaceTree={lib.workspaceTree}
							selectedSection={lib.selectedSection}
							selectedNodeId={lib.selectedNode?.id ?? null}
							docsTitle={t("title")}
							isCollapsed={compactNavigatorCollapsed}
							onCollapsedChange={setCompactNavigatorCollapsed}
							onSelectDocumentsRoot={lib.handleSelectDocumentsSection}
							onSelectWorkspaceRoot={lib.handleSelectWorkspaceSection}
							onSelectDocNode={lib.handleSelectDocNode}
							onSelectWorkspaceNode={lib.handleSelectWorkspaceNode}
							onToggleExpand={lib.handleToggleExpand}
							onToggleExpandWorkspace={lib.handleToggleExpandWorkspace}
							onMove={lib.handleMove}
							onRenameNode={handleTreeRename}
							onDeleteNode={handleTreeDelete}
						/>
						<div className="min-w-0 flex-1 overflow-hidden">
							<DocumentLibraryContent
								selectedNode={lib.selectedNode}
								isFileSelected={lib.isFileSelected}
								isFolderSelected={lib.isFolderSelected}
								isWorkspaceSection={lib.isWorkspaceSection}
								folderContents={lib.folderContents}
								viewMode={lib.viewMode}
								fileTopicMap={lib.fileTopicMap}
								selectedTopicIds={lib.selectedTopicIds}
								compact
								compactNavigatorToggle={
									lib.isFileSelected ? compactNavigatorExpandButton : null
								}
								onSelectNodeById={lib.handleSelectNodeInActiveTree}
								onOpenFolderByPath={lib.handleOpenFolderByPath}
								onCloseViewer={lib.handleCloseViewer}
								onDeleteItem={lib.handleDeleteItem}
								onRenameItem={lib.handleRenameItem}
								onDownloadFile={lib.handleDownloadFile}
								onDownloadSelectedFile={lib.handleDownloadSelectedFile}
								onManageTopics={lib.handleManageFileTopic}
								onConvertToKnowledge={lib.handleConvertToKnowledge}
								onDeleteSelectedFile={lib.handleDeleteSelectedFile}
								onToggleTopicFilter={lib.handleToggleTopicFilter}
							/>
						</div>
					</div>
				</>
			)}
		</div>
	);
};
