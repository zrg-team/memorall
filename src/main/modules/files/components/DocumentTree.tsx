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
	FileText,
	Image,
	FileCode,
	File,
} from "lucide-react";
import type { DocumentTreeNode, DocumentType } from "@/types/document-library";
import { ScrollArea } from "@/main/components/ui/scroll-area";

interface DocumentTreeProps {
	tree: DocumentTreeNode[];
	selectedId: string | null;
	onSelectNode: (node: DocumentTreeNode) => void;
	onToggleExpand?: (node: DocumentTreeNode) => void;
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
}

// Memoized row so an unchanged subtree is skipped when the tree re-renders (e.g.
// expanding one folder or a parent re-rendering with the same props). Recursion
// is a real component instead of an inline function recreated on every render.
const TreeNode: React.FC<TreeNodeProps> = React.memo(
	({ node, level, selectedId, onSelectNode, onToggleExpand }) => {
		const isSelected = node.id === selectedId;
		const hasChildren =
			node.type === "folder" && node.children && node.children.length > 0;
		const isFolder = node.type === "folder";

		// Get appropriate icon
		let IconComponent;
		let iconColorClass = "";

		if (isFolder) {
			IconComponent = node.isExpanded ? FolderOpen : Folder;
			iconColorClass = "text-blue-500";
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
					{/* Expand/Collapse Toggle (only for folders with children) */}
					{isFolder && hasChildren ? (
						<button
							onClick={(e) => {
								e.stopPropagation();
								onToggleExpand?.(node);
							}}
							className="p-0.5 hover:bg-muted rounded flex-shrink-0"
						>
							{node.isExpanded ? (
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
				</div>

				{/* Render Children (only if folder is expanded) */}
				{isFolder && hasChildren && node.isExpanded && (
					<div>
						{node.children.map((child) => (
							<TreeNode
								key={child.id}
								node={child}
								level={level + 1}
								selectedId={selectedId}
								onSelectNode={onSelectNode}
								onToggleExpand={onToggleExpand}
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
	({ tree, selectedId, onSelectNode, onToggleExpand }) => (
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
					/>
				))}
			</div>
		</ScrollArea>
	),
);
DocumentTree.displayName = "DocumentTree";
