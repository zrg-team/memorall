/**
 * Document Tree Component
 * Hierarchical navigation for document folders and files (like Windows Explorer)
 */

import React from "react";
import {
	ChevronRight,
	ChevronDown,
	Folder,
	FolderOpen,
	FolderSymlink,
	Loader2,
	FileText,
	Image,
	FileCode,
	File,
} from "lucide-react";
import type { DocumentTreeNode, DocumentType } from "@/types/document-library";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/main/components/ui/scroll-area";

interface DocumentTreeProps {
	tree: DocumentTreeNode[];
	selectedId: string | null;
	onSelectNode: (node: DocumentTreeNode) => void;
	onToggleExpand?: (node: DocumentTreeNode) => void;
	/**
	 * Top-level paths that are folders on the user's disk rather than in the
	 * library. They behave identically; only the icon says otherwise.
	 */
	mappedPaths?: ReadonlySet<string>;
}

const FILE_ICONS: Record<DocumentType, React.ComponentType<any>> = {
	pdf: FileText,
	text: FileText,
	markdown: FileCode,
	image: Image,
	excel: FileText,
	other: File,
};

const FILE_COLORS: Record<DocumentType, string> = {
	pdf: "text-red-500",
	text: "text-gray-500",
	markdown: "text-blue-500",
	image: "text-green-500",
	excel: "text-green-600",
	other: "text-gray-400",
};

interface TreeNodeProps {
	node: DocumentTreeNode;
	level: number;
	selectedId: string | null;
	onSelectNode: (node: DocumentTreeNode) => void;
	onToggleExpand?: (node: DocumentTreeNode) => void;
	mappedPaths?: ReadonlySet<string>;
}

// Memoized row so an unchanged subtree is skipped when the tree re-renders (e.g.
// expanding one folder or a parent re-rendering with the same props). Recursion
// is a real component instead of an inline function recreated on every render.
const TreeNode: React.FC<TreeNodeProps> = React.memo(
	({ node, level, selectedId, onSelectNode, onToggleExpand, mappedPaths }) => {
		const { t } = useTranslation("files");
		const isSelected = node.id === selectedId;
		// Only a root can be a mapped folder; everything inside one is ordinary.
		const isMapped = level === 0 && Boolean(mappedPaths?.has(node.path));
		const isFolder = node.type === "folder";
		const hasChildren = isFolder && node.children && node.children.length > 0;
		// A deferred folder has no children loaded yet, so `hasChildren` is false
		// while it is still very much openable — without this it renders with no
		// chevron and cannot be opened at all.
		const canExpand = isFolder && (hasChildren || node.isLazy === true);

		// Get appropriate icon
		let IconComponent;
		let iconColorClass = "";

		if (isFolder) {
			IconComponent = isMapped
				? FolderSymlink
				: node.isExpanded
					? FolderOpen
					: Folder;
			// Amber rather than blue: the only cue that edits here land on the
			// user's own disk instead of inside Memorall.
			iconColorClass = isMapped ? "text-amber-500" : "text-blue-500";
		} else {
			const fileType = node.file?.type || "other";
			IconComponent = FILE_ICONS[fileType];
			iconColorClass = FILE_COLORS[fileType];
		}

		return (
			<div>
				<div
					className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-accent rounded-sm transition-colors ${
						isSelected ? "bg-accent text-accent-foreground font-medium" : ""
					}`}
					style={{ paddingLeft: `${level * 12 + 8}px` }}
					onClick={() => onSelectNode(node)}
				>
					{/* Expand/Collapse Toggle (folders with children, or not read yet) */}
					{canExpand ? (
						<button
							onClick={(e) => {
								e.stopPropagation();
								onToggleExpand?.(node);
							}}
							className="p-0.5 hover:bg-muted rounded flex-shrink-0"
						>
							{node.isLoading ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							) : node.isExpanded ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
						</button>
					) : (
						<div className="w-4 flex-shrink-0" />
					)}

					{/* Icon */}
					<IconComponent
						className={`h-4 w-4 ${iconColorClass} flex-shrink-0`}
					/>

					{/* Name */}
					<span className="text-sm truncate flex-1">{node.name}</span>

					{/* A mapped folder lives on the user's disk, and edits inside it
					    are edits to their real files. The icon alone was too quiet to
					    carry that, so the row says so in words. */}
					{isMapped && (
						<span
							className="flex-shrink-0 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
							title={node.path}
						>
							{t("mappedFolders.badge")}
						</span>
					)}
				</div>

				{/* Render Children (only if folder is expanded) */}
				{isFolder && node.isExpanded && hasChildren && (
					<div>
						{node.children.map((child) => (
							<TreeNode
								key={child.id}
								node={child}
								level={level + 1}
								selectedId={selectedId}
								onSelectNode={onSelectNode}
								onToggleExpand={onToggleExpand}
								mappedPaths={mappedPaths}
							/>
						))}
					</div>
				)}
			</div>
		);
	},
);
TreeNode.displayName = "TreeNode";

export const DocumentTree: React.FC<DocumentTreeProps> = React.memo(
	({ tree, selectedId, onSelectNode, onToggleExpand, mappedPaths }) => (
		<ScrollArea className="h-full">
			<div className="py-2 px-1">
				{tree.map((node) => (
					<TreeNode
						key={node.id}
						node={node}
						level={0}
						selectedId={selectedId}
						onSelectNode={onSelectNode}
						onToggleExpand={onToggleExpand}
						mappedPaths={mappedPaths}
					/>
				))}
			</div>
		</ScrollArea>
	),
);
DocumentTree.displayName = "DocumentTree";
