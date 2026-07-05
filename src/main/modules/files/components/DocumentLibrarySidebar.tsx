import React, { memo, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocumentTreeDraggable } from "./DocumentTreeDraggable";
import { PageHeader } from "@/main/components/ui/page-header";
import type { DocumentTreeNode } from "@/types/document-library";
import { cn } from "@/lib/utils";

interface DocumentLibrarySidebarProps {
	tree: DocumentTreeNode[];
	workspaceTree: DocumentTreeNode[];
	selectedSection: "documents" | "workspace";
	selectedNodeId: string | null;
	docsTitle: string;
	collapseButton?: React.ReactNode;
	onSelectDocumentsRoot: () => void;
	onSelectDocNode: (node: DocumentTreeNode) => void;
	onSelectWorkspaceNode: (node: DocumentTreeNode) => void;
	/** Called when the user clicks the "Workspace" section header. */
	onSelectWorkspaceRoot: () => void;
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

export const DocumentLibrarySidebar = memo(function DocumentLibrarySidebar({
	tree,
	workspaceTree,
	selectedSection,
	selectedNodeId,
	docsTitle,
	collapseButton,
	onSelectDocumentsRoot,
	onSelectDocNode,
	onSelectWorkspaceNode,
	onSelectWorkspaceRoot,
	onToggleExpand,
	onToggleExpandWorkspace,
	onMove,
	onRenameNode,
	onDeleteNode,
}: DocumentLibrarySidebarProps) {
	const { t } = useTranslation("documents");
	const [docsExpanded, setDocsExpanded] = useState(true);
	const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
	const showWorkspaceSection = workspaceTree.length > 0;

	useEffect(() => {
		setDocsExpanded(selectedSection === "documents");
		setWorkspaceExpanded(selectedSection === "workspace");
	}, [selectedSection]);

	return (
		<div className="flex h-full flex-col overflow-hidden flex-shrink-0 bg-background">
			<PageHeader
				icon={<FileText size={20} />}
				title={docsTitle}
				description={t("description")}
				collapseButton={collapseButton}
				className="h-[102px]"
			/>

			{/* Documents Section */}
			<button
				className={cn(
					"flex items-center gap-1.5 px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors flex-shrink-0 text-left w-full",
					selectedSection === "documents"
						? "text-foreground"
						: "text-muted-foreground hover:text-foreground",
				)}
				onClick={() => {
					if (selectedSection === "documents") {
						setDocsExpanded((v) => !v);
						return;
					}
					onSelectDocumentsRoot();
				}}
			>
				{docsExpanded ? (
					<ChevronDown className="h-3 w-3 flex-shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 flex-shrink-0" />
				)}
				{docsTitle}
			</button>

			{docsExpanded && (
				<div className="flex-1 overflow-hidden min-h-0">
					<DocumentTreeDraggable
						tree={tree}
						selectedId={selectedSection === "documents" ? selectedNodeId : null}
						onSelectNode={(node) => {
							setDocsExpanded(true);
							setWorkspaceExpanded(false);
							onSelectDocNode(node);
						}}
						onToggleExpand={onToggleExpand}
						onMove={onMove}
						onRename={onRenameNode}
						onDelete={onDeleteNode}
					/>
				</div>
			)}

			{showWorkspaceSection ? (
				<>
					{/* Legacy workspace section, hidden once the root migration is active. */}
					<button
						className={cn(
							"flex items-center gap-1.5 px-2 py-2 text-xs font-semibold uppercase tracking-wide transition-colors flex-shrink-0 text-left w-full border-t",
							selectedSection === "workspace"
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => {
							if (selectedSection === "workspace") {
								setWorkspaceExpanded((v) => !v);
								return;
							}
							onSelectWorkspaceRoot();
						}}
					>
						{workspaceExpanded ? (
							<ChevronDown className="h-3 w-3 flex-shrink-0" />
						) : (
							<ChevronRight className="h-3 w-3 flex-shrink-0" />
						)}
						{t("sidebar.workspace")}
					</button>

					{workspaceExpanded && (
						<div className="flex-1 overflow-hidden min-h-0">
							<DocumentTreeDraggable
								tree={workspaceTree}
								selectedId={
									selectedSection === "workspace" ? selectedNodeId : null
								}
								onSelectNode={(node) => {
									setWorkspaceExpanded(true);
									setDocsExpanded(false);
									onSelectWorkspaceNode(node);
								}}
								onToggleExpand={onToggleExpandWorkspace}
								onRename={onRenameNode}
								onDelete={onDeleteNode}
							/>
						</div>
					)}
				</>
			) : null}
		</div>
	);
});
