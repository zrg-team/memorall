/**
 * Document Viewer Component
 * Display detailed information and preview for selected document
 */

import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	FileText,
	Calendar,
	HardDrive,
	FileType,
	Download,
	Trash2,
	Info,
	BookmarkPlus,
	Tag,
	Code,
	Eye,
} from "lucide-react";
import { eq, inArray } from "drizzle-orm";

import { logInfo, logError } from "@/utils/logger";
import { serviceManager } from "@/services";
import { useIsProcessing } from "@/main/stores/process-monitor";
import type { DocumentFile } from "@/types/document-library";
import type { Topic } from "@/services/database/types";
import { ScrollArea } from "@/main/components/ui/scroll-area";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { Separator } from "@/main/components/ui/separator";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	toDocumentsSandboxPath,
	toWorkspacesSandboxPath,
} from "@/services/filesystem/sandbox-paths";

import { FileConflictBanner } from "./FileConflictBanner";
import {
	DocumentViewerHeader,
	type ViewerAction,
} from "./DocumentViewerHeader";
import { PDFPageSelector } from "./PDFPageSelector";
import { LazyExcelViewer } from "./LazyExcelViewer";
import { LazyPresentationViewer } from "./LazyPresentationViewer";
import { ExcelSheetSelector } from "./ExcelSheetSelector";
import { useModalSelector } from "../hooks/use-modal-selector";
import { useSourceStatus } from "../hooks/use-source-status";
import { type SyncedFile, useDocumentSync } from "../hooks/use-document-sync";
import { editorRegistry } from "../editors";
import { CodeEditor } from "../editors/CodeEditor";
import { isZipFileName } from "@/services/filesystem/folder-zip";
import { useFileIndexActions } from "../folder-index";
import { useHostedAppFor } from "../hooks/use-hosted-app";
import { changeTouches } from "../utils/change-touches";
import { HostedAppFrame } from "./HostedAppFrame";
import { HOSTED_APPS_DATA_DIR } from "@/services/memon/apps/hosted/catalog";

interface DocumentViewerProps {
	file: DocumentFile;
	isWorkspaceFile?: boolean;
	compact?: boolean;
	compactNavigatorToggle?: React.ReactNode;
	onClose?: () => void;
	onDelete?: () => void;
	onDownload?: () => void;
	onManageTopics?: (file: DocumentFile) => void;
	onConvertToKnowledge?: (file: DocumentFile) => void;
	fileTopics?: Topic[];
	selectedTopicIds?: string[];
	onTopicClick?: (topicId: string) => void;
}

/**
 * The bytes as a Blob part. Blob copies them anyway; copying first as well
 * doubled the memory a large PDF or video took to open. Only bytes over a
 * shared buffer, which Blob refuses, need their own copy.
 */
const blobPart = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
	bytes.buffer instanceof ArrayBuffer
		? (bytes as Uint8Array<ArrayBuffer>)
		: bytes.slice();

/**
 * Whether bytes are not text: a zero byte early on, as git and curl tell.
 * Decoded and drawn as code, a big zip overflowed the stack.
 */
const isBinaryContent = (bytes: Uint8Array): boolean =>
	bytes.subarray(0, 8000).includes(0);

/** One empty list, so a default does not count as a new prop each render. */
const EMPTY_TOPIC_IDS: string[] = [];

/** Shown when the browser cannot decode a stored audio or video file. */
const MediaUnsupportedNote: React.FC = () => {
	const { t } = useTranslation("documents");
	return (
		<p className="max-w-xl text-center text-xs text-muted-foreground">
			{t("viewer.mediaUnsupported", {
				defaultValue:
					"This browser can't play this file's format. Download it to open it in another app.",
			})}
		</p>
	);
};

// Memoised: the page around it redraws for the tree, the list and the index
// status, and redrawing the viewer re-renders the open document with it.
export const DocumentViewer = React.memo(function DocumentViewer({
	file,
	isWorkspaceFile = false,
	compact = false,
	compactNavigatorToggle,
	onClose,
	onDelete,
	onDownload,
	onManageTopics,
	onConvertToKnowledge,
	fileTopics: propFileTopics,
	selectedTopicIds = EMPTY_TOPIC_IDS,
	onTopicClick,
}: DocumentViewerProps) {
	const { t, i18n } = useTranslation("documents");
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [mediaError, setMediaError] = useState(false);
	const [textContent, setTextContent] = useState<string | null>(null);
	/** An "other" file that is not text: it gets a note, not the code view. */
	const [binary, setBinary] = useState(false);
	const [excelData, setExcelData] = useState<Uint8Array | null>(null);
	const [presentationData, setPresentationData] = useState<Uint8Array | null>(
		null,
	);
	const [loading, setLoading] = useState(false);
	const [showProperties, setShowProperties] = useState(false);
	const [htmlShowCode, setHtmlShowCode] = useState(false);
	// SVG is text the user can edit, previewed as the image it draws.
	const isSvg =
		file.mimeType === "image/svg+xml" ||
		file.name.toLowerCase().endsWith(".svg");
	const isHtml =
		file.mimeType === "text/html" || file.name.toLowerCase().endsWith(".html");
	const pdfPageSelector = useModalSelector();
	const excelSheetSelector = useModalSelector();
	const [loadedFileTopics, setLoadedFileTopics] = useState<Topic[]>([]);

	// Track knowledge generation status using source and process monitor
	const sourceStatus = useSourceStatus(file.path);
	const isProcessing = useIsProcessing(file.path);

	// Use prop topics if provided, otherwise use loaded topics
	const fileTopics = propFileTopics || loadedFileTopics;
	const sandboxPath = isWorkspaceFile
		? toWorkspacesSandboxPath(file.path)
		: toDocumentsSandboxPath(file.id);
	// Spreadsheets, Word documents, slides, boards and PDFs open in their app
	// when this build has it; the built-in previews stay for the rest.
	const hosted = useHostedAppFor(file.name);
	const inHostedApp = hosted.app !== null && hosted.available !== false;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a preview is read again only when another file opens, or when its app turns out to be missing.
	useEffect(() => {
		// Reset content state when file changes
		setTextContent(null);
		setBinary(false);
		setPreviewUrl(null);
		setExcelData(null);
		setPresentationData(null);
		setMediaError(false);
		// A file left mid-load never clears its own spinner (its read is
		// cancelled), and a text file never sets one.
		setLoading(false);
		// The app reads the file itself.
		if (inHostedApp) return;
		// This read's own URL, and whether another file was opened since: the
		// state is stale in the cleanup, so revoking from it never released one.
		let url: string | null = null;
		let cancelled = false;

		// Load preview for supported file types
		const loadPreview = async () => {
			const loadContent = async (): Promise<Uint8Array> =>
				documentFileSystemService.readFile(sandboxPath);

			if (
				file.type === "pdf" ||
				(file.type === "image" && !isSvg) ||
				file.type === "audio" ||
				file.type === "video"
			) {
				setLoading(true);
				try {
					const content = await loadContent();
					if (cancelled) return;
					const blob = new Blob([blobPart(content)], { type: file.mimeType });
					url = URL.createObjectURL(blob);
					setPreviewUrl(url);
				} catch (error) {
					logError("Failed to load preview:", error);
				} finally {
					if (!cancelled) setLoading(false);
				}
			} else if (
				file.type === "text" ||
				file.type === "markdown" ||
				file.type === "other" ||
				isSvg
			) {
				try {
					const content = await loadContent();
					if (cancelled) return;
					if (file.type === "other" && isBinaryContent(content)) {
						setBinary(true);
						return;
					}
					const textDecoder = new TextDecoder("utf-8");
					const text = textDecoder.decode(content);
					setTextContent(text);
				} catch (error) {
					logError("Failed to load text content:", error);
				}
			} else if (file.type === "excel") {
				setLoading(true);
				try {
					logInfo("Loading Excel file content for:", file.name);
					const content = await loadContent();
					if (cancelled) return;
					logInfo("Excel content loaded, size:", content.length, "bytes");
					setExcelData(content);
					logInfo("Excel data set in state");
				} catch (error) {
					logError("Failed to load Excel file:", error);
				} finally {
					if (!cancelled) setLoading(false);
				}
			} else if (file.type === "presentation") {
				setLoading(true);
				try {
					const content = await loadContent();
					if (!cancelled) setPresentationData(content);
				} catch (error) {
					logError("Failed to load presentation:", error);
				} finally {
					if (!cancelled) setLoading(false);
				}
			}
		};

		loadPreview();

		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [file.id, inHostedApp]);

	// Load topics for this file (only if not provided via props)
	useEffect(() => {
		if (propFileTopics) return; // Skip if topics provided via props

		const loadTopics = async () => {
			try {
				// Get all topics and their files, then filter for this file
				const allTopics = await serviceManager.databaseService.use(
					async ({ db, schema }) => {
						// Get all topic_files entries for this file
						const topicFileEntries = await db
							.select()
							.from(schema.topicFiles)
							.where(eq(schema.topicFiles.filePath, file.path));

						if (topicFileEntries.length === 0) {
							return [];
						}

						// Get the topics for these entries
						const topicIds = topicFileEntries.map((tf) => tf.topicId);
						const topics = await db
							.select()
							.from(schema.topics)
							.where(inArray(schema.topics.id, topicIds));

						return topics;
					},
				);

				setLoadedFileTopics(allTopics);
			} catch (error) {
				logError("Failed to load file topics:", error);
			}
		};

		loadTopics();
	}, [file.path, propFileTopics]);

	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return "0 B";
		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	};

	const formatDate = (date: Date): string => {
		return new Intl.DateTimeFormat(i18n.language, {
			month: "long",
			day: "numeric",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(date);
	};

	// Text files follow their file on disk while open: the agent may write them.
	const isTextFile =
		!inHostedApp &&
		(file.type === "text" ||
			file.type === "markdown" ||
			file.type === "other" ||
			isSvg);
	const syncedFile = useMemo<SyncedFile | null>(
		() =>
			isTextFile
				? {
						read: async () =>
							new TextDecoder("utf-8").decode(
								await documentFileSystemService.readFile(sandboxPath),
							),
						// Workspace saves notify (may update composition previews).
						// Document saves are quiet: the library does not redraw (the
						// editor would reset), while the sandbox and other contexts
						// still get the change.
						write: (content) =>
							documentFileSystemService.writeFile(
								sandboxPath,
								isWorkspaceFile ? content : new TextEncoder().encode(content),
								isWorkspaceFile || "quiet",
							),
						subscribe: (listener) =>
							documentFileSystemService.onFilesystemChanged((change) => {
								if (changeTouches(change, sandboxPath)) listener();
							}),
					}
				: null,
		[isTextFile, isWorkspaceFile, sandboxPath],
	);
	const sync = useDocumentSync(syncedFile, textContent, setTextContent);

	const handleSaveContent = async (content: string): Promise<void> => {
		try {
			await sync.save(content);
			logInfo(`[DOCUMENT_VIEWER] Saved ${file.name}`);
		} catch (error) {
			logError("[DOCUMENT_VIEWER] Failed to save file:", error);
			throw error;
		}
	};

	const handleConvertPages = () => {
		// Simplified callback - conversion happens in background job now
		logInfo("PDF pages converted successfully");
		alert(t("viewer.convertSuccess"));
	};

	// The header's actions: drawn as icons, or in one menu when the viewer is narrow.
	const indexActions = useFileIndexActions(file.path, !isWorkspaceFile);
	const converting = sourceStatus.isGenerating || isProcessing;
	const convertLabel = t("viewer.convertToKnowledge");
	const convertIcon = <BookmarkPlus className="h-4 w-4 text-primary" />;
	const convertAction: ViewerAction | null =
		file.type === "pdf"
			? {
					id: "convert",
					label: convertLabel,
					icon: convertIcon,
					onSelect: pdfPageSelector.openSelector,
				}
			: file.type === "excel"
				? {
						id: "convert",
						label: convertLabel,
						icon: convertIcon,
						onSelect: excelSheetSelector.openSelector,
					}
				: (file.type === "text" ||
							file.type === "markdown" ||
							file.type === "other" ||
							file.type === "presentation") &&
						onConvertToKnowledge
					? {
							id: "convert",
							label: converting ? t("viewer.converting") : convertLabel,
							icon: convertIcon,
							disabled: converting,
							onSelect: () => onConvertToKnowledge(file),
						}
					: null;
	const headerActions: ViewerAction[] = [
		...indexActions.actions,
		...(convertAction ? [convertAction] : []),
		{
			id: "properties",
			label: t("viewer.properties"),
			icon: <Info className="h-4 w-4" />,
			pressed: showProperties,
			onSelect: () => setShowProperties(!showProperties),
		},
		...(onDownload
			? [
					{
						id: "download",
						label: t("viewer.download"),
						icon: <Download className="h-4 w-4" />,
						onSelect: onDownload,
					},
				]
			: []),
		...(onDelete
			? [
					{
						id: "delete",
						label: t("viewer.delete"),
						icon: <Trash2 className="h-4 w-4" />,
						onSelect: onDelete,
						destructive: true,
					},
				]
			: []),
	];
	const headerDetail = file.metadata?.pageCount
		? t("viewer.pages", { count: file.metadata.pageCount })
		: file.metadata?.sheetCount
			? t("viewer.sheets", { count: file.metadata.sheetCount })
			: undefined;

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col bg-card">
			<DocumentViewerHeader
				title={file.name}
				detail={headerDetail}
				leading={compact ? compactNavigatorToggle : undefined}
				topics={fileTopics}
				activeTopicIds={selectedTopicIds}
				onTopicClick={onTopicClick}
				onManageTopics={onManageTopics ? () => onManageTopics(file) : undefined}
				actions={headerActions}
				onClose={onClose}
			/>
			{indexActions.dialogs}

			{/* Content Area - Flex layout */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{sync.conflict && (
					<FileConflictBanner
						base={sync.conflict.base}
						disk={sync.conflict.disk}
						onReload={sync.reload}
						onKeepMine={sync.keepMine}
					/>
				)}
				{inHostedApp && hosted.app ? (
					hosted.available ? (
						<HostedAppFrame
							app={hosted.app}
							path={sandboxPath}
							home={HOSTED_APPS_DATA_DIR}
						/>
					) : (
						<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
							{t("viewer.loadingPreview")}
						</div>
					)
				) : null}

				{/* Preview Section - Takes remaining space */}
				{file.type === "pdf" && previewUrl && (
					<div className="flex-1 overflow-hidden p-3 sm:p-4">
						<div className="border rounded-lg overflow-hidden h-full">
							<iframe
								src={previewUrl}
								className="w-full h-full"
								title={file.name}
							/>
						</div>
					</div>
				)}

				{file.type === "audio" && previewUrl && (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 sm:p-4">
						<div className="w-full max-w-xl rounded-lg border bg-muted/20 p-4">
							{/* biome-ignore lint/a11y/useMediaCaption: user audio has no captions to offer */}
							<audio
								key={previewUrl}
								src={previewUrl}
								controls
								preload="metadata"
								className="w-full"
								onError={() => setMediaError(true)}
								data-document-audio
							/>
						</div>
						{mediaError ? <MediaUnsupportedNote /> : null}
					</div>
				)}

				{file.type === "video" && previewUrl && (
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 sm:p-4">
						<div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg border bg-black">
							{/* biome-ignore lint/a11y/useMediaCaption: user video has no captions to offer */}
							<video
								key={previewUrl}
								src={previewUrl}
								controls
								playsInline
								preload="metadata"
								className="h-full w-full object-contain"
								onError={() => setMediaError(true)}
								data-document-video
							/>
						</div>
						{mediaError ? <MediaUnsupportedNote /> : null}
					</div>
				)}

				{file.type === "image" && !isSvg && previewUrl && (
					<div className="flex-1 overflow-hidden p-3 sm:p-4">
						<div className="border rounded-lg overflow-hidden h-full flex items-center justify-center bg-muted/20">
							<img
								src={previewUrl}
								alt={file.name}
								className="max-w-full max-h-full object-contain"
							/>
						</div>
					</div>
				)}

				{textContent !== null && (isHtml || isSvg) && (
					<div className="flex-1 flex flex-col overflow-hidden p-3 sm:p-4 gap-2">
						<div className="flex justify-end">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setHtmlShowCode((prev) => !prev)}
								className="h-7 gap-1.5 text-xs"
							>
								{htmlShowCode ? (
									<>
										<Eye className="h-3.5 w-3.5" />
										{t("viewer.preview")}
									</>
								) : (
									<>
										<Code className="h-3.5 w-3.5" />
										{t("viewer.code")}
									</>
								)}
							</Button>
						</div>
						<div className="flex-1 border rounded-lg overflow-hidden">
							{htmlShowCode ? (
								<CodeEditor
									file={file}
									initialContent={textContent}
									onContentChange={sync.onContentChange}
									onDirtyChange={sync.onDirtyChange}
									onSave={handleSaveContent}
								/>
							) : isSvg ? (
								<div
									className="flex h-full w-full p-4"
									style={{
										background:
											"repeating-conic-gradient(rgb(128 128 128 / 0.12) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px",
									}}
								>
									{/* As an image, the SVG's scripts never run. */}
									<img
										src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(textContent)}`}
										alt={file.name}
										className="h-full min-h-0 w-full object-contain"
									/>
								</div>
							) : (
								<iframe
									srcDoc={textContent}
									sandbox="allow-scripts allow-same-origin"
									className="w-full h-full bg-white"
									title={file.name}
								/>
							)}
						</div>
					</div>
				)}

				{binary && (
					<div className="flex flex-1 items-center justify-center p-6">
						<p className="max-w-xl text-center text-sm text-muted-foreground">
							{t(
								isZipFileName(file.name)
									? "viewer.zipNoPreview"
									: "viewer.binaryNoPreview",
							)}
						</p>
					</div>
				)}

				{(file.type === "text" || file.type === "other") &&
					textContent !== null &&
					!isHtml &&
					!isSvg && (
						<div className="flex-1 overflow-hidden">
							<CodeEditor
								file={file}
								initialContent={textContent}
								onContentChange={sync.onContentChange}
								onDirtyChange={sync.onDirtyChange}
								onSave={handleSaveContent}
							/>
						</div>
					)}

				{file.type === "markdown" &&
					textContent !== null &&
					(() => {
						const EditorComponent =
							editorRegistry.getEditorComponent("markdown");
						if (EditorComponent) {
							return (
								<div className="flex-1 overflow-hidden">
									<EditorComponent
										file={file}
										initialContent={textContent}
										onContentChange={sync.onContentChange}
										onDirtyChange={sync.onDirtyChange}
										onSave={handleSaveContent}
									/>
								</div>
							);
						}
						// Fallback to text preview if editor not available
						return (
							<ScrollArea className="flex-1 p-4">
								<div className="border rounded-lg p-4 bg-muted/20">
									<pre className="text-sm whitespace-pre-wrap font-mono">
										{textContent}
									</pre>
								</div>
							</ScrollArea>
						);
					})()}

				{file.type === "excel" && excelData && (
					<div className="flex-1 overflow-hidden p-3 sm:p-4">
						<div className="border rounded-lg overflow-hidden h-full">
							<LazyExcelViewer
								fileData={excelData}
								fileName={file.name}
								className="h-full"
							/>
						</div>
					</div>
				)}

				{file.type === "presentation" && presentationData && (
					<div className="flex-1 overflow-hidden p-3 sm:p-4">
						<div className="h-full overflow-hidden rounded-lg border">
							<LazyPresentationViewer
								fileData={presentationData}
								fileName={file.name}
							/>
						</div>
					</div>
				)}

				{loading && (
					<div className="flex-1 overflow-hidden p-3 sm:p-4">
						<div className="flex items-center justify-center h-full border rounded-lg">
							<div className="text-sm text-muted-foreground">
								{t("viewer.loadingPreview")}
							</div>
						</div>
					</div>
				)}

				{/* Metadata Section - Only show when showProperties is true */}
				{showProperties && (
					<ScrollArea className="max-h-[45%] flex-shrink-0 border-t sm:max-h-[400px]">
						<div className="p-4 space-y-4">
							<h3 className="text-sm font-semibold">
								{t("viewer.documentInformation")}
							</h3>

							<div className="grid grid-cols-1 gap-3">
								{file.metadata?.title && (
									<div className="flex items-start gap-3">
										<FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
										<div className="flex-1 min-w-0">
											<div className="text-xs text-muted-foreground">
												{t("viewer.title")}
											</div>
											<div className="text-sm">{file.metadata.title}</div>
										</div>
									</div>
								)}

								{file.metadata?.author && (
									<div className="flex items-start gap-3">
										<FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
										<div className="flex-1 min-w-0">
											<div className="text-xs text-muted-foreground">
												{t("viewer.author")}
											</div>
											<div className="text-sm">{file.metadata.author}</div>
										</div>
									</div>
								)}

								{file.metadata?.sheetCount && (
									<div className="flex items-start gap-3">
										<FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
										<div className="flex-1 min-w-0">
											<div className="text-xs text-muted-foreground">
												{t("viewer.sheetsLabel")}
											</div>
											<div className="text-sm">{file.metadata.sheetCount}</div>
										</div>
									</div>
								)}

								{file.metadata?.sheetNames &&
									file.metadata.sheetNames.length > 0 && (
										<div className="flex items-start gap-3">
											<FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
											<div className="flex-1 min-w-0">
												<div className="text-xs text-muted-foreground">
													{t("viewer.sheetNames")}
												</div>
												<div className="text-sm">
													{file.metadata.sheetNames.join(", ")}
												</div>
											</div>
										</div>
									)}

								<Separator />

								<div className="flex items-start gap-3">
									<FileType className="h-4 w-4 mt-0.5 text-muted-foreground" />
									<div className="flex-1 min-w-0">
										<div className="text-xs text-muted-foreground">
											{t("viewer.type")}
										</div>
										<div className="text-sm">{file.mimeType}</div>
									</div>
								</div>

								<div className="flex items-start gap-3">
									<HardDrive className="h-4 w-4 mt-0.5 text-muted-foreground" />
									<div className="flex-1 min-w-0">
										<div className="text-xs text-muted-foreground">
											{t("viewer.size")}
										</div>
										<div className="text-sm">{formatFileSize(file.size)}</div>
									</div>
								</div>

								<div className="flex items-start gap-3">
									<Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
									<div className="flex-1 min-w-0">
										<div className="text-xs text-muted-foreground">
											{t("viewer.created")}
										</div>
										<div className="text-sm">{formatDate(file.createdAt)}</div>
									</div>
								</div>

								<div className="flex items-start gap-3">
									<Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
									<div className="flex-1 min-w-0">
										<div className="text-xs text-muted-foreground">
											{t("viewer.modified")}
										</div>
										<div className="text-sm">{formatDate(file.modifiedAt)}</div>
									</div>
								</div>
							</div>

							{/* Tags Section */}
							{file.metadata?.tags && file.metadata.tags.length > 0 && (
								<div className="space-y-2">
									<h3 className="text-sm font-semibold">{t("viewer.tags")}</h3>
									<div className="flex flex-wrap gap-2">
										{file.metadata.tags.map((tag, index) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: tags may repeat.
											<Badge key={index} variant="outline">
												{tag}
											</Badge>
										))}
									</div>
								</div>
							)}

							{/* Topics Section */}
							{fileTopics.length > 0 && (
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Tag className="h-4 w-4 text-muted-foreground" />
										<h3 className="text-sm font-semibold">
											{t("viewer.topics")}
										</h3>
									</div>
									<div className="flex flex-wrap gap-2">
										{fileTopics.map((topic) => (
											<Badge key={topic.id} variant="secondary">
												{topic.name}
											</Badge>
										))}
									</div>
								</div>
							)}

							{/* Description Section */}
							{file.metadata?.description && (
								<div className="space-y-2">
									<h3 className="text-sm font-semibold">
										{t("viewer.description")}
									</h3>
									<p className="text-sm text-muted-foreground">
										{file.metadata.description}
									</p>
								</div>
							)}
						</div>
					</ScrollArea>
				)}
			</div>

			{/* PDF Page Selector Dialog */}
			{file.type === "pdf" && (
				<PDFPageSelector
					file={file}
					open={pdfPageSelector.showSelector}
					onOpenChange={pdfPageSelector.setShowSelector}
					onConvert={handleConvertPages}
				/>
			)}

			{/* Excel Sheet Selector Dialog */}
			{file.type === "excel" && (
				<ExcelSheetSelector
					file={file}
					open={excelSheetSelector.showSelector}
					onOpenChange={excelSheetSelector.setShowSelector}
					onConvert={handleConvertPages}
				/>
			)}
		</div>
	);
});
