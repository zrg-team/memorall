/**
 * Document List Component
 * Grid/List view for documents and folders
 */

import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
	File,
	FileText,
	Image,
	FileCode,
	Folder,
	MoreVertical,
	Tags,
	Edit,
	Download,
	Trash2,
	Brain,
} from "lucide-react";
import type {
	DocumentLibraryItem,
	DocumentType,
	DocumentFile,
} from "@/types/document-library";

import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from "@/main/components/ui/dropdown-menu";
import { Input } from "@/main/components/ui/input";
import { TopicBadgeList } from "@/main/modules/topics/components";
import type { Topic } from "@/services/database/types";
import { useProcessMonitor } from "@/main/stores/process-monitor";

import type { SourceStatus } from "../hooks/use-source-status";
import { logError } from "@/utils/logger";

interface DocumentListProps {
	items: DocumentLibraryItem[];
	selectedItem: DocumentLibraryItem | null;
	onSelectItem: (item: DocumentLibraryItem) => void;
	onOpenFolder?: (path: string) => void;
	onDeleteItem?: (item: DocumentLibraryItem) => void;
	onDownloadFile?: (fileId: string) => void;
	onManageTopics?: (file: DocumentFile) => void;
	onRenameItem?: (item: DocumentLibraryItem, newName: string) => void;
	onConvertToKnowledge?: (file: DocumentFile) => void;
	fileTopicMap?: Map<string, Topic[]>;
	selectedTopicIds?: string[];
	onTopicClick?: (topicId: string) => void;
	sourceStatusMap?: Map<string, SourceStatus>;
	viewMode?: "grid" | "list";
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

export const DocumentList: React.FC<DocumentListProps> = ({
	items,
	selectedItem,
	onSelectItem,
	onOpenFolder,
	onDeleteItem,
	onDownloadFile,
	onManageTopics,
	onRenameItem,
	onConvertToKnowledge,
	fileTopicMap,
	selectedTopicIds = [],
	onTopicClick,
	sourceStatusMap,
	viewMode = "list",
}) => {
	const { t } = useTranslation("documents");
	const [editingItem, setEditingItem] = useState<string | null>(null);
	const [editingName, setEditingName] = useState<string>("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Get the isProcessing function once at component level (not inside loops)
	const isProcessing = useProcessMonitor((state) => state.isProcessing);

	useEffect(() => {
		if (editingItem && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingItem]);

	// Clear editing state when the item name is successfully updated in the data
	useEffect(() => {
		if (editingItem && editingName) {
			const currentItem = items.find((item) => item.item.id === editingItem);
			if (currentItem && currentItem.item.name === editingName.trim()) {
				// The item's name in the data now matches what we renamed it to
				// This means the rename was successful, so we can exit editing mode
				setEditingItem(null);
				setEditingName("");
			}
		}
	}, [items]);

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
		// Don't handle clicks when editing
		if (editingItem === item.item.id) return;

		if (item.type === "folder") {
			onOpenFolder?.(item.item.path);
		} else {
			onSelectItem(item);
		}
	};

	const handleStartRename = (item: DocumentLibraryItem) => {
		setEditingItem(item.item.id);
		setEditingName(item.item.name);
	};

	const handleSaveRename = async (item: DocumentLibraryItem) => {
		if (editingName.trim() && editingName !== item.item.name) {
			try {
				await onRenameItem?.(item, editingName.trim());
				// Don't clear editing state immediately - wait for data to update
				// The useEffect below will handle clearing when the name actually changes
			} catch (error) {
				// If rename fails, clear the editing state
				logError("Rename failed:", error);
				setEditingItem(null);
				setEditingName("");
			}
		} else {
			// No changes made, just cancel
			setEditingItem(null);
			setEditingName("");
		}
	};

	const handleCancelRename = () => {
		setEditingItem(null);
		setEditingName("");
	};

	const handleKeyDown = (e: React.KeyboardEvent, item: DocumentLibraryItem) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleSaveRename(item);
		} else if (e.key === "Escape") {
			e.preventDefault();
			handleCancelRename();
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
					const isEditing = editingItem === folder.id;
					return (
						<div
							key={folder.id}
							className={`flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-accent transition-colors sm:gap-3 sm:px-4 ${
								isSelected ? "bg-accent" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Folder className="h-5 w-5 text-blue-500 flex-shrink-0" />
							<div className="flex-1 min-w-0">
								{isEditing ? (
									<Input
										ref={inputRef}
										value={editingName}
										onChange={(e) => setEditingName(e.target.value)}
										onKeyDown={(e) => handleKeyDown(e, item)}
										onBlur={() => handleSaveRename(item)}
										className="h-6 text-sm font-medium"
										onClick={(e) => e.stopPropagation()}
									/>
								) : (
									<div className="font-medium text-sm truncate">
										{folder.name}
									</div>
								)}
								<div className="text-xs text-muted-foreground">
									{t("list.items", { count: folder.childCount })}
								</div>
							</div>
							<div className="hidden flex-shrink-0 text-xs text-muted-foreground sm:block">
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
									{onRenameItem && (
										<>
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													handleStartRename(item);
												}}
											>
												<Edit className="h-4 w-4 mr-2" />
												{t("list.rename")}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									<DropdownMenuItem
										onClick={() => onDeleteItem?.(item)}
										className="text-destructive"
									>
										{t("list.deleteFolder")}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				} else {
					const file = item.item;
					const Icon = FILE_ICONS[file.type];
					const colorClass = FILE_COLORS[file.type];
					const fileTopics = fileTopicMap?.get(file.path) || [];
					const isEditing = editingItem === file.id;
					const fileIsProcessing = isProcessing(file.path);

					return (
						<div
							key={file.id}
							className={`flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-accent transition-colors sm:gap-3 sm:px-4 ${
								isSelected ? "bg-accent" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							<Icon className={`h-5 w-5 ${colorClass} flex-shrink-0`} />
							<div className="flex-1 min-w-0">
								{isEditing ? (
									<Input
										ref={inputRef}
										value={editingName}
										onChange={(e) => setEditingName(e.target.value)}
										onKeyDown={(e) => handleKeyDown(e, item)}
										onBlur={() => handleSaveRename(item)}
										className="h-6 text-sm font-medium"
										onClick={(e) => e.stopPropagation()}
									/>
								) : (
									<div className="font-medium text-sm truncate">
										{file.name}
									</div>
								)}
								<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
									<span>{formatFileSize(file.size)}</span>
									<Badge variant="outline" className="text-xs">
										{file.type.toUpperCase()}
									</Badge>
								</div>
								{/* Topic Badges */}
								{fileTopics.length > 0 && (
									<div className="mt-1" onClick={(e) => e.stopPropagation()}>
										<TopicBadgeList
											topics={fileTopics}
											maxVisible={3}
											size="sm"
											onTopicClick={(topic) => onTopicClick?.(topic.id)}
											activeTopicIds={selectedTopicIds}
										/>
									</div>
								)}
							</div>
							<div className="hidden flex-shrink-0 text-xs text-muted-foreground sm:block">
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
									{onManageTopics && (
										<>
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													onManageTopics(file);
												}}
											>
												<Tags className="h-4 w-4 mr-2" />
												{t("list.manageTopics")}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									{onConvertToKnowledge && (
										<>
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													onConvertToKnowledge(file);
												}}
												disabled={
													sourceStatusMap?.get(file.path)?.isGenerating ||
													fileIsProcessing
												}
											>
												<Brain className="h-4 w-4 mr-2" />
												{sourceStatusMap?.get(file.path)?.isGenerating ||
												fileIsProcessing
													? t("list.converting")
													: t("list.convertToKnowledge")}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									{onRenameItem && (
										<>
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													handleStartRename(item);
												}}
											>
												<Edit className="h-4 w-4 mr-2" />
												{t("list.rename")}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									<DropdownMenuItem onClick={() => onDownloadFile?.(file.id)}>
										<Download className="h-4 w-4 mr-2" />
										{t("list.download")}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={() => onDeleteItem?.(item)}
										className="text-destructive"
									>
										<Trash2 className="h-4 w-4 mr-2" />
										{t("list.delete")}
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
		<div className="grid grid-cols-1 gap-3 p-3 min-[400px]:grid-cols-2 sm:grid-cols-3 sm:gap-4 sm:p-4 md:grid-cols-4 lg:grid-cols-5">
			{items.map((item) => {
				const isSelected =
					selectedItem?.type === item.type &&
					selectedItem?.item.id === item.item.id;

				if (item.type === "folder") {
					const folder = item.item;
					const isEditing = editingItem === folder.id;
					return (
						<div
							key={folder.id}
							className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent border-primary" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							{/* Context Menu */}
							<div
								className="absolute top-2 right-2"
								onClick={(e) => e.stopPropagation()}
							>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="sm" className="h-6 w-6 p-0">
											<MoreVertical className="h-3.5 w-3.5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{onRenameItem && (
											<>
												<DropdownMenuItem
													onClick={(e) => {
														e.stopPropagation();
														handleStartRename(item);
													}}
												>
													<Edit className="h-4 w-4 mr-2" />
													{t("list.rename")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
											</>
										)}
										<DropdownMenuItem
											onClick={() => onDeleteItem?.(item)}
											className="text-destructive"
										>
											<Trash2 className="h-4 w-4 mr-2" />
											{t("list.deleteFolder")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							<Folder className="h-12 w-12 text-blue-500" />
							{isEditing ? (
								<Input
									ref={inputRef}
									value={editingName}
									onChange={(e) => setEditingName(e.target.value)}
									onKeyDown={(e) => handleKeyDown(e, item)}
									onBlur={() => handleSaveRename(item)}
									className="h-6 text-sm font-medium text-center w-full"
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								<div className="text-sm font-medium text-center truncate w-full">
									{folder.name}
								</div>
							)}
							<div className="text-xs text-muted-foreground">
								{t("list.items", { count: folder.childCount })}
							</div>
						</div>
					);
				} else {
					const file = item.item;
					const Icon = FILE_ICONS[file.type];
					const colorClass = FILE_COLORS[file.type];
					const fileTopics = fileTopicMap?.get(file.path) || [];
					const isEditing = editingItem === file.id;
					const fileIsProcessing = isProcessing(file.path);

					return (
						<div
							key={file.id}
							className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
								isSelected ? "bg-accent border-primary" : ""
							}`}
							onClick={() => handleItemClick(item)}
						>
							{/* Context Menu */}
							<div
								className="absolute top-2 right-2"
								onClick={(e) => e.stopPropagation()}
							>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="sm" className="h-6 w-6 p-0">
											<MoreVertical className="h-3.5 w-3.5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{onManageTopics && (
											<>
												<DropdownMenuItem
													onClick={(e) => {
														e.stopPropagation();
														onManageTopics(file);
													}}
												>
													<Tags className="h-4 w-4 mr-2" />
													{t("list.manageTopics")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
											</>
										)}
										{onConvertToKnowledge && (
											<>
												<DropdownMenuItem
													onClick={(e) => {
														e.stopPropagation();
														onConvertToKnowledge(file);
													}}
													disabled={
														sourceStatusMap?.get(file.path)?.isGenerating ||
														fileIsProcessing
													}
												>
													<Brain className="h-4 w-4 mr-2" />
													{sourceStatusMap?.get(file.path)?.isGenerating ||
													fileIsProcessing
														? t("list.converting")
														: t("list.convertToKnowledge")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
											</>
										)}
										{onRenameItem && (
											<>
												<DropdownMenuItem
													onClick={(e) => {
														e.stopPropagation();
														handleStartRename(item);
													}}
												>
													<Edit className="h-4 w-4 mr-2" />
													{t("list.rename")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
											</>
										)}
										<DropdownMenuItem onClick={() => onDownloadFile?.(file.id)}>
											<Download className="h-4 w-4 mr-2" />
											{t("list.download")}
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											onClick={() => onDeleteItem?.(item)}
											className="text-destructive"
										>
											<Trash2 className="h-4 w-4 mr-2" />
											{t("list.delete")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							<Icon className={`h-12 w-12 ${colorClass}`} />
							{isEditing ? (
								<Input
									ref={inputRef}
									value={editingName}
									onChange={(e) => setEditingName(e.target.value)}
									onKeyDown={(e) => handleKeyDown(e, item)}
									onBlur={() => handleSaveRename(item)}
									className="h-6 text-sm font-medium text-center w-full"
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								<div className="text-sm font-medium text-center truncate w-full">
									{file.name}
								</div>
							)}
							<Badge variant="outline" className="text-xs">
								{file.type.toUpperCase()}
							</Badge>
							<div className="text-xs text-muted-foreground">
								{formatFileSize(file.size)}
							</div>

							{/* Topic Badges */}
							{fileTopics.length > 0 && (
								<div className="w-full" onClick={(e) => e.stopPropagation()}>
									<TopicBadgeList
										topics={fileTopics}
										maxVisible={2}
										size="sm"
										onTopicClick={(topic) => onTopicClick?.(topic.id)}
										activeTopicIds={selectedTopicIds}
										className="justify-center"
									/>
								</div>
							)}
						</div>
					);
				}
			})}
		</div>
	);

	if (items.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground flex-1">
				<div className="text-center">
					<Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
					<p className="text-sm">{t("list.emptyFolder")}</p>
					<p className="text-xs mt-1">{t("list.emptyFolderDescription")}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full min-w-0 overflow-auto flex-1">
			{viewMode === "list" ? renderListView() : renderGridView()}
		</div>
	);
};
