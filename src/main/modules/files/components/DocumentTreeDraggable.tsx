/**
 * Draggable Document Tree Component
 * Hierarchical navigation with drag-and-drop support for reorganizing files and folders
 */

import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	ChevronRight,
	ChevronDown,
	Folder,
	FolderOpen,
	FileText,
	Image,
	FileCode,
	File,
	Home,
	Pencil,
	Trash2,
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
	DragOverlay,
	useDroppable,
	useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { DocumentTreeNode, DocumentType } from "@/types/document-library";
import { cn } from "@/lib/utils";

interface DocumentTreeProps {
	tree: DocumentTreeNode[];
	selectedId: string | null;
	onSelectNode: (node: DocumentTreeNode) => void;
	onToggleExpand?: (node: DocumentTreeNode) => void;
	onMove?: (
		nodeId: string,
		targetFolderId: string,
		nodeType: "file" | "folder",
	) => void;
	onRename?: (node: DocumentTreeNode, newName: string) => void;
	onDelete?: (node: DocumentTreeNode) => void;
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

interface TreeItemProps {
	node: DocumentTreeNode;
	level: number;
	selectedId: string | null;
	onSelectNode: (node: DocumentTreeNode) => void;
	onToggleExpand?: (node: DocumentTreeNode) => void;
	onRename?: (node: DocumentTreeNode, newName: string) => void;
	onDelete?: (node: DocumentTreeNode) => void;
}

const TreeItem: React.FC<TreeItemProps> = ({
	node,
	level,
	selectedId,
	onSelectNode,
	onToggleExpand,
	onRename,
	onDelete,
}) => {
	const { t } = useTranslation("documents");
	const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const [renameValue, setRenameValue] = React.useState(node.name);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const [triggerPos, setTriggerPos] = React.useState({ x: 0, y: 0 });
	const hasChildren =
		node.type === "folder" && node.children && node.children.length > 0;
	const isFolder = node.type === "folder";
	const isSelected = node.id === selectedId;

	// Use draggable for all items
	const {
		attributes: dragAttributes,
		listeners: dragListeners,
		setNodeRef: setDragRef,
		transform: dragTransform,
		isDragging,
	} = useDraggable({
		id: node.id,
		data: {
			type: node.type,
			node: node,
		},
	});

	// Use droppable for folders (separate from draggable)
	const { setNodeRef: setDropRef, isOver } = useDroppable({
		id: `droppable-${node.id}`,
		data: {
			type: node.type,
			node: node,
			nodeId: node.id,
		},
		disabled: !isFolder,
	});

	const dragStyle = {
		transform: dragTransform
			? CSS.Translate.toString(dragTransform)
			: undefined,
		opacity: isDragging ? 0.5 : 1,
	};

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

	const handleRenameSubmit = () => {
		const trimmed = renameValue.trim();
		if (trimmed && trimmed !== node.name) {
			onRename?.(node, trimmed);
		}
		setIsRenaming(false);
	};

	return (
		<div>
			{/* Droppable wrapper only for the folder row itself */}
			<DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
				<div
					ref={isFolder ? setDropRef : undefined}
					className={cn(isOver && isFolder && "bg-primary/10 rounded-sm")}
				>
					<div
						ref={setDragRef}
						{...dragAttributes}
						{...dragListeners}
						className={cn(
							"relative flex items-center gap-1 px-2 py-1 rounded-sm transition-colors cursor-grab active:cursor-grabbing",
							isSelected && "bg-accent text-accent-foreground font-medium",
							!isDragging && "hover:bg-accent",
							isOver && isFolder && "ring-2 ring-primary ring-inset",
						)}
						style={{
							paddingLeft: `${level * 12 + 8}px`,
							transform: dragStyle.transform,
							opacity: dragStyle.opacity,
						}}
						onClick={() => {
							if (isRenaming) return;
							onSelectNode(node);
							// Also toggle expansion for folders when clicking anywhere on the folder
							if (isFolder && hasChildren) {
								onToggleExpand?.(node);
							}
						}}
						onContextMenu={(e) => {
							if (!onRename && !onDelete) return;
							e.preventDefault();
							e.stopPropagation();
							const rect = e.currentTarget.getBoundingClientRect();
							setTriggerPos({
								x: e.clientX - rect.left,
								y: e.clientY - rect.top,
							});
							setContextMenuOpen(true);
						}}
					>
						{/* Hidden trigger anchors the DropdownMenuContent at cursor position */}
						<DropdownMenuTrigger
							className="absolute opacity-0 pointer-events-none w-0 h-0 overflow-hidden"
							style={{ left: triggerPos.x, top: triggerPos.y }}
							tabIndex={-1}
						/>
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

						{/* Name / Rename input */}
						{isRenaming ? (
							<input
								ref={renameInputRef}
								className="text-sm flex-1 min-w-0 bg-background border border-primary rounded px-1 outline-none"
								value={renameValue}
								autoFocus
								onClick={(e) => e.stopPropagation()}
								onChange={(e) => setRenameValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleRenameSubmit();
									if (e.key === "Escape") {
										setRenameValue(node.name);
										setIsRenaming(false);
									}
								}}
								onBlur={handleRenameSubmit}
							/>
						) : (
							<span className="text-sm truncate flex-1">{node.name}</span>
						)}
					</div>
				</div>
				<DropdownMenuContent align="start">
					{onRename && (
						<DropdownMenuItem
							onClick={() => {
								setRenameValue(node.name);
								setIsRenaming(true);
							}}
						>
							<Pencil className="h-4 w-4" />
							{t("tree.rename")}
						</DropdownMenuItem>
					)}
					{onRename && onDelete && <DropdownMenuSeparator />}
					{onDelete && (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={() => onDelete(node)}
						>
							<Trash2 className="h-4 w-4" />
							{t("tree.delete")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Render Children OUTSIDE droppable area */}
			{isFolder && hasChildren && node.isExpanded && (
				<div>
					{node.children.map((child) => (
						<TreeItem
							key={child.id}
							node={child}
							level={level + 1}
							selectedId={selectedId}
							onSelectNode={onSelectNode}
							onToggleExpand={onToggleExpand}
							onRename={onRename}
							onDelete={onDelete}
						/>
					))}
				</div>
			)}
		</div>
	);
};

export const DocumentTreeDraggable: React.FC<DocumentTreeProps> = ({
	tree,
	selectedId,
	onSelectNode,
	onToggleExpand,
	onMove,
	onRename,
	onDelete,
}) => {
	const [activeId, setActiveId] = React.useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8, // Require 8px movement to start drag (prevents accidental drags)
			},
		}),
		useSensor(KeyboardSensor),
	);

	// Flatten tree to find nodes by ID
	const flattenedTree = useMemo(() => {
		const flatten = (nodes: DocumentTreeNode[]): DocumentTreeNode[] => {
			return nodes.flatMap((node) => {
				if (node.type === "folder" && node.children) {
					return [node, ...flatten(node.children)];
				}
				return [node];
			});
		};
		return flatten(tree);
	}, [tree]);

	const activeNode = useMemo(
		() => flattenedTree.find((node) => node.id === activeId),
		[activeId, flattenedTree],
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		setActiveId(null);

		if (!over || active.id === over.id) {
			return;
		}

		const activeNode = flattenedTree.find((node) => node.id === active.id);
		if (!activeNode) {
			return;
		}

		// Determine target folder
		let targetFolderId: string;

		// Check if dropped on root drop zone
		if (over.id === "root-dropzone") {
			targetFolderId = "/";
		} else {
			// Extract node ID from droppable ID
			const overNodeId =
				typeof over.id === "string" && over.id.startsWith("droppable-")
					? over.id.replace("droppable-", "")
					: over.id;

			const overNode = flattenedTree.find((node) => node.id === overNodeId);
			if (!overNode) {
				return;
			}

			if (overNode.type === "folder") {
				// Dropped onto a folder - move into it
				targetFolderId = overNode.path;
			} else {
				// Dropped onto a file - move into its parent folder
				targetFolderId =
					overNode.path.substring(0, overNode.path.lastIndexOf("/")) || "/";
			}
		}

		// Get current parent folder of the active node
		const currentParentPath =
			activeNode.path.substring(0, activeNode.path.lastIndexOf("/")) || "/";

		// Don't do anything if dropping into the same folder
		if (currentParentPath === targetFolderId) {
			return;
		}

		// Prevent moving a folder into itself or its children
		if (
			activeNode.type === "folder" &&
			targetFolderId.startsWith(activeNode.path)
		) {
			return;
		}

		// Trigger move callback
		onMove?.(activeNode.id, targetFolderId, activeNode.type);
	};

	// Root drop zone component (only visible when dragging)
	const RootDropZone = () => {
		const { t } = useTranslation("documents");
		const { setNodeRef, isOver } = useDroppable({
			id: "root-dropzone",
			data: {
				type: "folder",
				path: "/",
			},
		});

		if (!activeId) return null;

		return (
			<div
				ref={setNodeRef}
				className={cn(
					"mx-2 mb-2 px-3 py-2 rounded-md border-2 border-dashed transition-all",
					isOver
						? "border-primary bg-primary/20 scale-105"
						: "border-muted-foreground/30 bg-muted/30",
				)}
			>
				<div className="flex items-center gap-2 text-sm">
					<Home className="h-4 w-4" />
					<span className="font-medium">
						{isOver ? t("tree.dropToRoot") : t("tree.rootFolder")}
					</span>
				</div>
			</div>
		);
	};

	const renderNode = (node: DocumentTreeNode, level: number = 0) => {
		return (
			<TreeItem
				key={node.id}
				node={node}
				level={level}
				selectedId={selectedId}
				onSelectNode={onSelectNode}
				onToggleExpand={onToggleExpand}
				onRename={onRename}
				onDelete={onDelete}
			/>
		);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div className="h-full overflow-y-auto">
				<div className="py-2 px-1">
					<RootDropZone />
					{tree.map((node) => renderNode(node))}
				</div>
			</div>

			<DragOverlay>
				{activeNode ? (
					<div className="bg-card border rounded-sm shadow-lg px-2 py-1 flex items-center gap-2">
						{activeNode.type === "folder" ? (
							<Folder className="h-4 w-4 text-blue-500" />
						) : (
							<FileText className="h-4 w-4 text-muted-foreground" />
						)}
						<span className="text-sm font-medium">{activeNode.name}</span>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
};
