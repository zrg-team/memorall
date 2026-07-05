import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import {
	ChevronDown,
	ChevronRight,
	Folder,
	PanelLeftClose,
} from "lucide-react";
import { DocumentTreeDraggable } from "./DocumentTreeDraggable";
import type { DocumentTreeNode } from "@/types/document-library";
import { cn } from "@/lib/utils";

interface DocumentLibraryCompactNavigatorProps {
	tree: DocumentTreeNode[];
	workspaceTree: DocumentTreeNode[];
	selectedSection: "documents" | "workspace";
	selectedNodeId: string | null;
	docsTitle: string;
	isCollapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onSelectDocumentsRoot: () => void;
	onSelectWorkspaceRoot: () => void;
	onSelectDocNode: (node: DocumentTreeNode) => void;
	onSelectWorkspaceNode: (node: DocumentTreeNode) => void;
	onToggleExpand: (node: DocumentTreeNode) => void;
	onToggleExpandWorkspace: (node: DocumentTreeNode) => void;
	onMove: (
		nodeId: string,
		targetFolderId: string,
		nodeType: "file" | "folder",
	) => void;
	onRenameNode?: (node: DocumentTreeNode, newName: string) => void;
	onDeleteNode?: (node: DocumentTreeNode) => void;
}

export const DocumentLibraryCompactNavigator = memo(
	function DocumentLibraryCompactNavigator({
		tree,
		workspaceTree,
		selectedSection,
		selectedNodeId,
		docsTitle,
		isCollapsed,
		onCollapsedChange,
		onSelectDocumentsRoot,
		onSelectWorkspaceRoot,
		onSelectDocNode,
		onSelectWorkspaceNode,
		onToggleExpand,
		onToggleExpandWorkspace,
		onMove,
		onRenameNode,
		onDeleteNode,
	}: DocumentLibraryCompactNavigatorProps) {
		const { t } = useTranslation("documents");
		const showWorkspaceSection = workspaceTree.length > 0;
		const renderSection = (
			section: "documents" | "workspace",
			label: string,
			onSelectRoot: () => void,
		) => {
			const isActive = selectedSection === section;
			const sectionTree = section === "workspace" ? workspaceTree : tree;
			const handleSelectNode =
				section === "workspace" ? onSelectWorkspaceNode : onSelectDocNode;
			const handleToggleExpand =
				section === "workspace" ? onToggleExpandWorkspace : onToggleExpand;
			const handleMove = section === "workspace" ? undefined : onMove;

			return (
				<div
					className={cn("relative min-h-0", isActive && "flex flex-1 flex-col")}
				>
					<button
						type="button"
						onClick={onSelectRoot}
						className={cn(
							"flex h-9 w-full items-center gap-2 rounded-md px-2 pr-8 text-left text-sm font-medium transition-colors",
							isActive
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
						aria-expanded={isActive}
					>
						{isActive ? (
							<ChevronDown className="h-4 w-4 flex-shrink-0" />
						) : (
							<ChevronRight className="h-4 w-4 flex-shrink-0" />
						)}
						<Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
						<span className="min-w-0 flex-1 truncate">{label}</span>
					</button>
					{isActive && (
						<div className="min-h-0 flex-1 overflow-hidden">
							<DocumentTreeDraggable
								tree={sectionTree}
								selectedId={selectedNodeId}
								onSelectNode={handleSelectNode}
								onToggleExpand={handleToggleExpand}
								onMove={handleMove}
								onRename={onRenameNode}
								onDelete={onDeleteNode}
							/>
						</div>
					)}
				</div>
			);
		};

		if (isCollapsed) {
			return null;
		}

		return (
			<aside className="relative flex h-full w-[42%] min-w-[190px] max-w-[240px] flex-col border-r bg-card">
				<button
					type="button"
					onClick={() => onCollapsedChange(true)}
					className="absolute right-1 top-3 z-20 flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
					title={t("navigator.collapse")}
					aria-label={t("navigator.collapse")}
				>
					<PanelLeftClose className="h-5 w-5" />
				</button>
				<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-2">
					{renderSection("documents", docsTitle, onSelectDocumentsRoot)}
					{showWorkspaceSection
						? renderSection(
								"workspace",
								t("sidebar.workspace"),
								onSelectWorkspaceRoot,
							)
						: null}
				</div>
			</aside>
		);
	},
);
