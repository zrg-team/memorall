/**
 * Document List Component
 * Grid/List view for documents and folders
 */

import React, {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	FileArchive,
	Trash2,
	Brain,
	FileAudio,
	FileVideo,
	Presentation,
	IdCard,
} from "lucide-react";
import type {
	DocumentLibraryItem,
	DocumentType,
	DocumentFile,
	DocumentFolder,
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
import { contentVisibilityAuto } from "@/main/components/atoms/content-visibility";
import { TopicBadgeList } from "@/main/modules/topics/components";
import type { Topic } from "@/services/database/types";
import {
	type ProcessMonitorState,
	useProcessMonitor,
} from "@/main/stores/process-monitor";

import type { SourceStatus } from "../hooks/use-source-status";
import type { EmbeddingSearchHit } from "@/services/folder-index/embedding/types";
import type { FolderIndexFileEntry } from "@/services/folder-index/types";
import { logError } from "@/utils/logger";
import {
	FolderIndexBadges,
	FolderIndexMenuItems,
	IndexTypeBadge,
	useFolderIndex,
} from "../folder-index";
import { hostedFileLook } from "../utils/hosted-file-look";

interface DocumentListProps {
	items: DocumentLibraryItem[];
	/** The folder shown, when its index entries and menus apply (not workspaces). */
	folderPath?: string;
	selectedItem: DocumentLibraryItem | null;
	onSelectItem: (item: DocumentLibraryItem) => void;
	onOpenFolder?: (path: string) => void;
	onDeleteItem?: (item: DocumentLibraryItem) => void;
	onDownloadFile?: (fileId: string) => void;
	/** Downloads a folder, with everything in it, as one .zip. */
	onDownloadFolder?: (folder: DocumentFolder) => void;
	onManageTopics?: (file: DocumentFile) => void;
	onRenameItem?: (item: DocumentLibraryItem, newName: string) => void;
	onConvertToKnowledge?: (file: DocumentFile) => void;
	fileTopicMap?: Map<string, Topic[]>;
	selectedTopicIds?: string[];
	onTopicClick?: (topicId: string) => void;
	sourceStatusMap?: Map<string, SourceStatus>;
	viewMode?: "grid" | "list";
	searchActive?: boolean;
	searchBusy?: boolean;
	searchHits?: Map<string, EmbeddingSearchHit>;
}

const FILE_ICONS: Record<DocumentType, React.ComponentType<any>> = {
	pdf: FileText,
	text: FileText,
	markdown: FileCode,
	image: Image,
	audio: FileAudio,
	video: FileVideo,
	excel: FileText,
	presentation: Presentation,
	other: File,
};

const FILE_COLORS: Record<DocumentType, string> = {
	pdf: "text-red-500",
	text: "text-gray-500",
	markdown: "text-blue-500",
	image: "text-green-500",
	audio: "text-violet-500",
	video: "text-pink-500",
	excel: "text-green-600",
	presentation: "text-orange-500",
	other: "text-gray-400",
};

const EMPTY_TOPICS: Topic[] = [];
const EMPTY_TOPIC_IDS: string[] = [];
/** A list row's height, held for rows scrolled out of view. */
const LIST_ROW_HEIGHT = 64;

const formatFileSize = (bytes: number): string => {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// One formatter for every row: building one is far dearer than using it.
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});
const formatDate = (date: Date): string => DATE_FORMAT.format(date);

/**
 * The files being converted right now, as one string: a selector that returns
 * the store's `isProcessing` function never changes, so the list never heard
 * that a conversion started or finished.
 */
const selectProcessingPaths = (state: ProcessMonitorState): string =>
	[...state.activeProcesses.keys()]
		.filter((path) => state.isProcessing(path))
		.join("\n");

type FileIndexEntries = Array<FolderIndexFileEntry & { typeId: string }>;

/** What every row does, built once per list so rows can be memoised. */
interface EntryActions {
	onItemClick: (item: DocumentLibraryItem) => void;
	onStartRename: (item: DocumentLibraryItem) => void;
	onSaveRename: (item: DocumentLibraryItem) => void;
	onRenameKeyDown: (e: React.KeyboardEvent, item: DocumentLibraryItem) => void;
	onEditingNameChange: (name: string) => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
	canRename: boolean;
	onDeleteItem?: (item: DocumentLibraryItem) => void;
	onDownloadFile?: (fileId: string) => void;
	onDownloadFolder?: (folder: DocumentFolder) => void;
	onManageTopics?: (file: DocumentFile) => void;
	onConvertToKnowledge?: (file: DocumentFile) => void;
	onTopicClick?: (topicId: string) => void;
	onOpenCard?: (path: string) => void;
}

interface EntryProps {
	item: DocumentLibraryItem;
	viewMode: "grid" | "list";
	isSelected: boolean;
	isEditing: boolean;
	/** The name being typed; empty for every row not being renamed. */
	editingName: string;
	searchActive: boolean;
	hit?: EmbeddingSearchHit;
	showFolderIndex: boolean;
	actions: EntryActions;
}

const SearchDetails: React.FC<{
	path: string;
	searchActive: boolean;
	hit?: EmbeddingSearchHit;
}> = ({ path, searchActive, hit }) => {
	const { t } = useTranslation("documents");
	if (!searchActive) return null;
	return (
		<div className="mt-1 min-w-0 w-full text-xs text-muted-foreground">
			<p className="truncate" title={path}>
				{path}
			</p>
			{hit && (
				<div className="mt-1">
					<IndexTypeBadge
						label={t("library.contentMatch")}
						className="normal-case tracking-normal"
					/>
					{hit.text && (
						<p className="mt-1 line-clamp-2 break-words">
							{hit.text.slice(0, 280)}
						</p>
					)}
				</div>
			)}
		</div>
	);
};

const RenameInput: React.FC<{
	item: DocumentLibraryItem;
	editingName: string;
	actions: EntryActions;
	className: string;
}> = ({ item, editingName, actions, className }) => (
	<Input
		ref={actions.inputRef}
		value={editingName}
		onChange={(e) => actions.onEditingNameChange(e.target.value)}
		onKeyDown={(e) => actions.onRenameKeyDown(e, item)}
		onBlur={() => actions.onSaveRename(item)}
		className={className}
		onClick={(e) => e.stopPropagation()}
	/>
);

// Rows are memoised: a status poll, a topic change or a rename elsewhere
// redraws only the rows it touches, not every file in a large folder.
const FolderEntry = memo(function FolderEntry({
	item,
	viewMode,
	isSelected,
	isEditing,
	editingName,
	searchActive,
	hit,
	showFolderIndex,
	actions,
}: EntryProps) {
	const { t } = useTranslation("documents");
	const folder = item.item as DocumentFolder;
	const { onDownloadFolder, onDeleteItem } = actions;

	if (viewMode === "list") {
		return (
			<div
				className={`flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-accent transition-colors sm:gap-3 sm:px-4 ${
					isSelected ? "bg-accent" : ""
				}`}
				style={contentVisibilityAuto(LIST_ROW_HEIGHT)}
				onClick={() => actions.onItemClick(item)}
			>
				<Folder className="h-5 w-5 text-blue-500 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					{isEditing ? (
						<RenameInput
							item={item}
							editingName={editingName}
							actions={actions}
							className="h-6 text-sm font-medium"
						/>
					) : (
						<div className="font-medium text-sm truncate">{folder.name}</div>
					)}
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						{t("list.items", { count: folder.childCount })}
						{showFolderIndex && (
							<FolderIndexBadges path={folder.path} className="flex gap-1" />
						)}
					</div>
					<SearchDetails
						path={folder.path}
						searchActive={searchActive}
						hit={hit}
					/>
				</div>
				<div className="hidden flex-shrink-0 text-xs text-muted-foreground sm:block">
					{formatDate(folder.modifiedAt)}
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
						<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{actions.canRename && (
							<>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										actions.onStartRename(item);
									}}
								>
									<Edit className="h-4 w-4 mr-2" />
									{t("list.rename")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						{onDownloadFolder && (
							<>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onDownloadFolder(folder);
									}}
								>
									<FileArchive className="h-4 w-4 mr-2" />
									{t("list.downloadZip")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						{showFolderIndex && <FolderIndexMenuItems path={folder.path} />}
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
	}

	return (
		<div
			className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
				isSelected ? "bg-accent border-primary" : ""
			}`}
			onClick={() => actions.onItemClick(item)}
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
						{actions.canRename && (
							<>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										actions.onStartRename(item);
									}}
								>
									<Edit className="h-4 w-4 mr-2" />
									{t("list.rename")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						{onDownloadFolder && (
							<>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onDownloadFolder(folder);
									}}
								>
									<FileArchive className="h-4 w-4 mr-2" />
									{t("list.downloadZip")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						)}
						{showFolderIndex && <FolderIndexMenuItems path={folder.path} />}
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
				<RenameInput
					item={item}
					editingName={editingName}
					actions={actions}
					className="h-6 text-sm font-medium text-center w-full"
				/>
			) : (
				<div className="text-sm font-medium text-center truncate w-full">
					{folder.name}
				</div>
			)}
			<div className="text-xs text-muted-foreground">
				{t("list.items", { count: folder.childCount })}
			</div>
			{showFolderIndex && (
				<FolderIndexBadges path={folder.path} className="flex gap-1" />
			)}
			<SearchDetails path={folder.path} searchActive={searchActive} hit={hit} />
		</div>
	);
});

const FileEntry = memo(function FileEntry({
	item,
	viewMode,
	isSelected,
	isEditing,
	editingName,
	searchActive,
	hit,
	actions,
	fileTopics,
	selectedTopicIds,
	indexEntries,
	converting,
}: EntryProps & {
	fileTopics: Topic[];
	selectedTopicIds: string[];
	indexEntries?: FileIndexEntries;
	/** Being turned into knowledge, by a source or a running process. */
	converting: boolean;
}) {
	const { t } = useTranslation("documents");
	const file = item.item as DocumentFile;
	const look = hostedFileLook(file.name);
	const Icon = look?.icon ?? FILE_ICONS[file.type];
	const colorClass = look?.color ?? FILE_COLORS[file.type];
	const {
		onManageTopics,
		onConvertToKnowledge,
		onDownloadFile,
		onDeleteItem,
		onTopicClick,
		onOpenCard,
	} = actions;

	const menuItems = (withCard: boolean) => (
		<>
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
						disabled={converting}
					>
						<Brain className="h-4 w-4 mr-2" />
						{converting ? t("list.converting") : t("list.convertToKnowledge")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
				</>
			)}
			{actions.canRename && (
				<>
					<DropdownMenuItem
						onClick={(e) => {
							e.stopPropagation();
							actions.onStartRename(item);
						}}
					>
						<Edit className="h-4 w-4 mr-2" />
						{t("list.rename")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
				</>
			)}
			{withCard && indexEntries?.some((entry) => entry.typeId === "okf") && (
				<>
					<DropdownMenuItem
						onClick={(e) => {
							e.stopPropagation();
							onOpenCard?.(file.path);
						}}
					>
						<IdCard className="h-4 w-4 mr-2" />
						{t("folderIndex.card.open")}
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
		</>
	);

	if (viewMode === "list") {
		return (
			<div
				className={`flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-accent transition-colors sm:gap-3 sm:px-4 ${
					isSelected ? "bg-accent" : ""
				}`}
				style={contentVisibilityAuto(LIST_ROW_HEIGHT)}
				onClick={() => actions.onItemClick(item)}
			>
				<Icon className={`h-5 w-5 ${colorClass} flex-shrink-0`} />
				<div className="flex-1 min-w-0">
					{isEditing ? (
						<RenameInput
							item={item}
							editingName={editingName}
							actions={actions}
							className="h-6 text-sm font-medium"
						/>
					) : (
						<div className="font-medium text-sm truncate">{file.name}</div>
					)}
					<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
						<span>{formatFileSize(file.size)}</span>
						<Badge variant="outline" className="text-xs">
							{file.type.toUpperCase()}
						</Badge>
						{indexEntries?.map((entry) => (
							<IndexTypeBadge
								key={entry.typeId}
								label={entry.type}
								className="normal-case tracking-normal"
								title={entry.typeId.toUpperCase()}
							/>
						))}
					</div>
					<SearchDetails
						path={file.path}
						searchActive={searchActive}
						hit={hit}
					/>
					{indexEntries?.[0]?.description && (
						<p className="mt-1 truncate text-xs text-muted-foreground">
							{indexEntries[0].description}
						</p>
					)}
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
					<DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
						<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{menuItems(true)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		);
	}

	return (
		<div
			className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer hover:bg-accent transition-colors ${
				isSelected ? "bg-accent border-primary" : ""
			}`}
			onClick={() => actions.onItemClick(item)}
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
						{menuItems(false)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<Icon className={`h-12 w-12 ${colorClass}`} />
			{isEditing ? (
				<RenameInput
					item={item}
					editingName={editingName}
					actions={actions}
					className="h-6 text-sm font-medium text-center w-full"
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
			<SearchDetails path={file.path} searchActive={searchActive} hit={hit} />

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
});

export const DocumentList: React.FC<DocumentListProps> = ({
	items,
	folderPath,
	selectedItem,
	onSelectItem,
	onOpenFolder,
	onDeleteItem,
	onDownloadFile,
	onDownloadFolder,
	onManageTopics,
	onRenameItem,
	onConvertToKnowledge,
	fileTopicMap,
	selectedTopicIds = EMPTY_TOPIC_IDS,
	onTopicClick,
	sourceStatusMap,
	viewMode = "list",
	searchActive = false,
	searchBusy = false,
	searchHits,
}) => {
	const { t } = useTranslation("documents");
	const folderIndex = useFolderIndex();
	const indexEntries =
		folderPath !== undefined
			? (folderIndex?.entriesOf(folderPath) ?? null)
			: null;
	// A state setter of the provider: the same function for the page's life.
	const openCard = folderIndex?.openCard;
	const [editingItem, setEditingItem] = useState<string | null>(null);
	const [editingName, setEditingName] = useState<string>("");
	const inputRef = useRef<HTMLInputElement>(null);
	// Read by the row actions, so they can stay the same functions while the
	// rename being typed changes.
	const editing = useRef({ id: editingItem, name: editingName });
	editing.current = { id: editingItem, name: editingName };

	const processingPaths = useProcessMonitor(selectProcessingPaths);
	const processing = useMemo(
		() => new Set(processingPaths ? processingPaths.split("\n") : []),
		[processingPaths],
	);

	useEffect(() => {
		if (editingItem && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingItem]);

	// Clear editing state when the item name is successfully updated in the data
	// biome-ignore lint/correctness/useExhaustiveDependencies: only new data can end a rename.
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

	const handleItemClick = useCallback(
		(item: DocumentLibraryItem) => {
			// Don't handle clicks when editing
			if (editing.current.id === item.item.id) return;

			if (item.type === "folder") {
				onOpenFolder?.(item.item.path);
			} else {
				onSelectItem(item);
			}
		},
		[onOpenFolder, onSelectItem],
	);

	const handleStartRename = useCallback((item: DocumentLibraryItem) => {
		setEditingItem(item.item.id);
		setEditingName(item.item.name);
	}, []);

	const handleCancelRename = useCallback(() => {
		setEditingItem(null);
		setEditingName("");
	}, []);

	const handleSaveRename = useCallback(
		async (item: DocumentLibraryItem) => {
			const name = editing.current.name;
			if (name.trim() && name !== item.item.name) {
				try {
					await onRenameItem?.(item, name.trim());
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
		},
		[onRenameItem],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent, item: DocumentLibraryItem) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSaveRename(item);
			} else if (e.key === "Escape") {
				e.preventDefault();
				handleCancelRename();
			}
		},
		[handleSaveRename, handleCancelRename],
	);

	const actions = useMemo<EntryActions>(
		() => ({
			onItemClick: handleItemClick,
			onStartRename: handleStartRename,
			onSaveRename: handleSaveRename,
			onRenameKeyDown: handleKeyDown,
			onEditingNameChange: setEditingName,
			inputRef,
			canRename: Boolean(onRenameItem),
			onDeleteItem,
			onDownloadFile,
			onDownloadFolder,
			onManageTopics,
			onConvertToKnowledge,
			onTopicClick,
			onOpenCard: openCard,
		}),
		[
			handleItemClick,
			handleStartRename,
			handleSaveRename,
			handleKeyDown,
			onRenameItem,
			onDeleteItem,
			onDownloadFile,
			onDownloadFolder,
			onManageTopics,
			onConvertToKnowledge,
			onTopicClick,
			openCard,
		],
	);

	const renderEntry = (item: DocumentLibraryItem) => {
		const isSelected =
			selectedItem?.type === item.type &&
			selectedItem?.item.id === item.item.id;
		const isEditing = editingItem === item.item.id;
		const common = {
			item,
			viewMode,
			isSelected,
			isEditing,
			editingName: isEditing ? editingName : "",
			searchActive,
			hit: searchActive ? searchHits?.get(item.item.path) : undefined,
			showFolderIndex: folderPath !== undefined,
			actions,
		};
		if (item.type === "folder") {
			return <FolderEntry key={item.item.id} {...common} />;
		}
		const path = item.item.path;
		return (
			<FileEntry
				key={item.item.id}
				{...common}
				fileTopics={fileTopicMap?.get(path) ?? EMPTY_TOPICS}
				selectedTopicIds={selectedTopicIds}
				indexEntries={indexEntries?.byFile.get(path)}
				converting={
					Boolean(sourceStatusMap?.get(path)?.isGenerating) ||
					processing.has(path)
				}
			/>
		);
	};

	if (items.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground flex-1">
				<div className="text-center">
					<Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
					<p className="text-sm">
						{t(
							searchActive
								? searchBusy
									? "library.searching"
									: "library.noSearchResults"
								: "list.emptyFolder",
						)}
					</p>
					<p className="text-xs mt-1">
						{t(
							searchActive
								? "library.searchHint"
								: "list.emptyFolderDescription",
						)}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full min-w-0 overflow-auto flex-1">
			{viewMode === "list" ? (
				<div className="divide-y divide-border">{items.map(renderEntry)}</div>
			) : (
				<div className="grid grid-cols-1 gap-3 p-3 min-[400px]:grid-cols-2 sm:grid-cols-3 sm:gap-4 sm:p-4 md:grid-cols-4 lg:grid-cols-5">
					{items.map(renderEntry)}
				</div>
			)}
		</div>
	);
};
