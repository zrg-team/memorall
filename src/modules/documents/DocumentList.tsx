/**
 * Document List Component
 * Grid/List view for documents and folders
 */

import React from "react";
import {
	File,
	FileText,
	Image,
	FileCode,
	Folder,
	MoreVertical,
} from "lucide-react";
import type {
	DocumentLibraryItem,
	DocumentType,
} from "@/types/document-library";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface DocumentListProps {
	items: DocumentLibraryItem[];
	selectedItem: DocumentLibraryItem | null;
	onSelectItem: (item: DocumentLibraryItem) => void;
	onOpenFolder?: (path: string) => void;
	onDeleteItem?: (item: DocumentLibraryItem) => void;
	onDownloadFile?: (fileId: string) => void;
	viewMode?: "grid" | "list";
}

const FILE_ICONS: Record<DocumentType, React.ComponentType<any>> = {
	pdf: FileText,
	text: FileText,
	markdown: FileCode,
	image: Image,
	other: File,
};

const FILE_COLORS: Record<DocumentType, string> = {
	pdf: "text-red-500",
	text: "text-gray-500",
	markdown: "text-blue-500",
	image: "text-green-500",
	other: "text-gray-400",
};

export const DocumentList: React.FC<DocumentListProps> = ({
	items,
	selectedItem,
	onSelectItem,
	onOpenFolder,
	onDeleteItem,
	onDownloadFile,
	viewMode = "list",
}) => {
	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return "0 B";
		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	};

	const formatDate = (date: Date): string => {
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(date);
	};

	const handleItemClick = (item: DocumentLibraryItem) => {
		if (item.type === "folder") {
			onOpenFolder?.(item.item.path);
		} else {
			onSelectItem(item);
		}
	};

	const renderListView = () => (
		<div className="divide-y divide-border">
			{items.map((item) => {
				const isSelected =
					selectedItem?.type === item.type &&
					selectedItem?.item.id === item.item.id;

				if (item.type === "folder") {
					const folder = item.item;
					return (
						<div
							key={folder.id}
							className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Folder className="h-5 w-5 text-blue-500 flex-shrink-0" />
							<div className="flex-1 min-w-0">
								<div className="font-medium text-sm truncate">
									{folder.name}
								</div>
								<div className="text-xs text-muted-foreground">
									{folder.childCount} items
								</div>
							</div>
							<div className="text-xs text-muted-foreground">
								{formatDate(folder.modifiedAt)}
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger
									asChild
									onClick={(e) => e.stopPropagation()}
								>
									<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
										<MoreVertical className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem
										onClick={() => onDeleteItem?.(item)}
										className="text-destructive"
									>
										Delete Folder
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				} else {
					const file = item.item;
					const Icon = FILE_ICONS[file.type];
					const colorClass = FILE_COLORS[file.type];

					return (
						<div
							key={file.id}
							className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Icon className={`h-5 w-5 ${colorClass} flex-shrink-0`} />
							<div className="flex-1 min-w-0">
								<div className="font-medium text-sm truncate">{file.name}</div>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{formatFileSize(file.size)}</span>
									<Badge variant="outline" className="text-xs">
										{file.type.toUpperCase()}
									</Badge>
								</div>
							</div>
							<div className="text-xs text-muted-foreground">
								{formatDate(file.modifiedAt)}
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger
									asChild
									onClick={(e) => e.stopPropagation()}
								>
									<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
										<MoreVertical className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => onDownloadFile?.(file.id)}>
										Download
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={() => onDeleteItem?.(item)}
										className="text-destructive"
									>
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				}
			})}
		</div>
	);

	const renderGridView = () => (
		<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
			{items.map((item) => {
				const isSelected =
					selectedItem?.type === item.type &&
					selectedItem?.item.id === item.item.id;

				if (item.type === "folder") {
					const folder = item.item;
					return (
						<div
							key={folder.id}
							className={`flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent border-primary" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Folder className="h-12 w-12 text-blue-500" />
							<div className="text-sm font-medium text-center truncate w-full">
								{folder.name}
							</div>
							<div className="text-xs text-muted-foreground">
								{folder.childCount} items
							</div>
						</div>
					);
				} else {
					const file = item.item;
					const Icon = FILE_ICONS[file.type];
					const colorClass = FILE_COLORS[file.type];

					return (
						<div
							key={file.id}
							className={`flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent border-primary" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Icon className={`h-12 w-12 ${colorClass}`} />
							<div className="text-sm font-medium text-center truncate w-full">
								{file.name}
							</div>
							<Badge variant="outline" className="text-xs">
								{file.type.toUpperCase()}
							</Badge>
							<div className="text-xs text-muted-foreground">
								{formatFileSize(file.size)}
							</div>
						</div>
					);
				}
			})}
		</div>
	);

	if (items.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground">
				<div className="text-center">
					<Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
					<p className="text-sm">This folder is empty</p>
					<p className="text-xs mt-1">Upload files to get started</p>
				</div>
			</div>
		);
	}

	return (
		<ScrollArea className="h-full">
			{viewMode === "list" ? renderListView() : renderGridView()}
		</ScrollArea>
	);
};
