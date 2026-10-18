import {
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FileText,
	Loader2,
	Minus,
	Plus,
	ScanText,
	Square,
	Upload,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { ocrInstructions } from "@/services/llm/utils/ocr-instructions";
import { v4 } from "@/utils/uuid";
import { useStudioStore } from "@/main/stores/studio";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import {
	extractOCR,
	isCancellation,
	saveStudioInput,
} from "../../services/studio-service";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import { StoredImage } from "../shared/StoredImage";
import { useStudioModelPicker } from "../shared/studio-model-picker";
import type { StudioCanvasProps } from "../studio-canvas";
import {
	OCR_ACCEPT,
	openOCRDocument,
	parseOCRLayout,
	type OCRDocument,
} from "./ocr-document";
import { OCRPreview } from "./OCRPreview";
import { ocrResultData } from "./ocr-data";
import { resolveOCRPages, type OCRPageSelection } from "./ocr-pages";
import { OCRBlockLegend, OCRBlocks, OCRDocumentOverlay } from "./OCRBlocks";
import { buildOCRFile, type OCRFileFormat } from "./ocr-file";

export function OCRStudio({
	model,
	items,
	ensureModelReady,
	isNarrow,
}: StudioCanvasProps) {
	const { t } = useTranslation("studio");
	const picker = useStudioModelPicker();
	const local = model.provider === "transformer-media";
	const instructionKey = `memorall.studio.ocr.instructions.${model.serviceName}:${model.modelId}`;
	const [instructions, setInstructions] = useState<string | null>(null);
	const uploadId = useId();
	const conversationId = items[0]?.conversationId;
	const [document, setDocument] = useState<OCRDocument | null>(null);
	const documentRef = useRef<OCRDocument | null>(null);
	const openingRef = useRef(0);
	const [opening, setOpening] = useState(false);
	const [page, setPage] = useState(1);
	const [pageSelection, setPageSelection] =
		useState<OCRPageSelection>("current");
	const [customPages, setCustomPages] = useState("");
	const [grounding, setGrounding] = useState(false);
	const [preview, setPreview] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState<{
		page: number;
		done: number;
		total: number;
	} | null>(null);
	const [copied, setCopied] = useState(false);
	const [activeBlock, setActiveBlock] = useState<number | null>(null);
	const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);
	const [resultView, setResultView] = useState("auto");
	const [zoom, setZoom] = useState(100);
	const [fileFormat, setFileFormat] = useState<OCRFileFormat>("markdown");
	const rootRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const busy = opening || progress !== null;
	const selection = useMemo(() => {
		if (!document) return { pages: [], error: null };
		try {
			return {
				pages: resolveOCRPages(
					pageSelection,
					page,
					document.pageCount,
					customPages,
				),
				error: null,
			};
		} catch (cause) {
			return {
				pages: [],
				error: cause instanceof Error ? cause.message : String(cause),
			};
		}
	}, [document, pageSelection, page, customPages]);
	const selected =
		selectedId === "input"
			? undefined
			: (items.find((item) => item.id === selectedId) ?? items.at(-1));
	const text =
		selected?.parts
			.filter((part) => part.type === "text" && part.role === "transcript")
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("\n\n") ?? "";
	const { markdown, blocks } = useMemo(() => parseOCRLayout(text), [text]);
	const storedImage = selected?.parts.find(
		(part) => part.type === "image" && part.image.role === "input",
	);
	const data = useMemo(() => ocrResultData(items, selected), [items, selected]);
	const json = data ? JSON.stringify(data, null, 2) : "";
	const output = useMemo(
		() => (data ? buildOCRFile(data, fileFormat) : null),
		[data, fileFormat],
	);
	const view =
		resultView === "auto" ? (blocks.length ? "blocks" : "preview") : resultView;
	const highlightedBlock = hoveredBlock ?? activeBlock;

	useEffect(() => {
		setActiveBlock(null);
		setHoveredBlock(null);
		setResultView("auto");
		setZoom(100);
	}, [selected?.id]);

	useEffect(() => {
		if (activeBlock !== null && view === "blocks")
			rootRef.current
				?.querySelector(`[data-ocr-block="${activeBlock}"]`)
				?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
	}, [activeBlock, view]);

	useEffect(() => {
		try {
			setInstructions(localStorage.getItem(instructionKey));
		} catch {
			setInstructions(null);
		}
	}, [instructionKey]);

	useEffect(
		() => () => {
			openingRef.current++;
			controllerRef.current?.abort();
			documentRef.current?.close();
		},
		[],
	);

	useEffect(() => {
		if (!document) {
			setPreview(null);
			return;
		}
		const controller = new AbortController();
		let url: string | null = null;
		setPreview(null);
		setPreviewLoading(true);
		void document
			.renderPage(page, controller.signal)
			.then((blob) => {
				if (controller.signal.aborted) return;
				url = URL.createObjectURL(blob);
				setPreview(url);
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => {
				if (!controller.signal.aborted) setPreviewLoading(false);
			});
		return () => {
			controller.abort();
			if (url) URL.revokeObjectURL(url);
		};
	}, [document, page]);

	useEffect(() => {
		if (!copied) return;
		const timeout = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timeout);
	}, [copied]);
	useEffect(() => {
		setSelectedId(null);
		setError(null);
	}, [conversationId]);

	const upload = async (file?: File) => {
		if (!file || controllerRef.current) return;
		const opening = ++openingRef.current;
		setOpening(true);
		setError(null);
		try {
			const next = await openOCRDocument(file);
			if (opening !== openingRef.current) {
				next.close();
				return;
			}
			documentRef.current?.close();
			documentRef.current = next;
			setDocument(next);
			setPage(1);
			setPageSelection("current");
			setCustomPages("");
			setSelectedId("input");
		} catch (cause) {
			if (opening === openingRef.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (opening === openingRef.current) setOpening(false);
		}
	};

	const extract = async () => {
		if (
			!document ||
			controllerRef.current ||
			opening ||
			selection.error ||
			!selection.pages.length
		)
			return;
		const controller = new AbortController();
		controllerRef.current = controller;
		let sessionId =
			useStudioStore.getState().modes.ocr?.currentConversationId ?? null;
		const checkSession = () => {
			controller.signal.throwIfAborted();
			if (
				(useStudioStore.getState().modes.ocr?.currentConversationId ?? null) !==
				sessionId
			) {
				controller.abort();
				controller.signal.throwIfAborted();
			}
		};
		const pages = selection.pages;
		const batchId = v4();
		setError(null);
		setProgress({ page: pages[0]!, done: 0, total: pages.length });
		try {
			const ready = await ensureModelReady();
			checkSession();
			for (const [index, pageNumber] of pages.entries()) {
				checkSession();
				setPage(pageNumber);
				setProgress({ page: pageNumber, done: index, total: pages.length });
				const blob = await document.renderPage(pageNumber, controller.signal);
				checkSession();
				const image = await saveStudioInput(blob, "image");
				checkSession();
				const item = await extractOCR({
					model: ready,
					image,
					fileName: document.name,
					pageNumber,
					pageCount: document.pageCount,
					batchId,
					selectedPages: pages,
					instructions: instructions ?? undefined,
					grounding,
					signal: controller.signal,
				});
				sessionId ??= item.conversationId;
				checkSession();
				setSelectedId(item.id);
			}
		} catch (cause) {
			if (controller.signal.aborted || isCancellation(cause))
				setError(t("ocr.stopped"));
			else setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			controllerRef.current = null;
			setProgress(null);
		}
	};

	const download = () => {
		if (!output) return;
		const url = URL.createObjectURL(
			new Blob([output.content], { type: output.mimeType }),
		);
		const anchor = window.document.createElement("a");
		anchor.href = url;
		anchor.download = output.fileName;
		window.document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	return (
		<div
			ref={rootRef}
			className="h-full overflow-y-auto overscroll-contain"
			data-studio-canvas="ocr"
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			}}
			onDrop={(event) => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				if (!busy) void upload(event.dataTransfer.files[0]);
			}}
		>
			<div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
				<div>
					<div className="mb-2 flex items-center gap-2">
						<ScanText size={22} className="text-primary" />
						<h2 className="text-xl font-semibold">{t("modes.ocr.label")}</h2>
					</div>
					<p className="text-sm text-muted-foreground">
						{t("modes.ocr.description")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background p-3">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="text-xs font-medium text-muted-foreground">
							{t("ocr.model")}
						</span>
						<div data-studio-model-pill>
							{picker ?? <span className="text-sm">{model.modelId}</span>}
						</div>
					</div>
					<label className="ml-auto flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={grounding}
							onChange={(event) => setGrounding(event.target.checked)}
							disabled={busy}
						/>
						{t("ocr.layout")}
					</label>
				</div>
				<p className="-mt-3 text-xs text-muted-foreground">
					{t(local ? "ocr.localHint" : "ocr.modelHint")}
				</p>
				<details className="rounded-lg border bg-background p-3 text-sm">
					<summary className="cursor-pointer">{t("ocr.instructions")}</summary>
					<label className="mt-3 block space-y-2 text-xs">
						<span className="text-muted-foreground">
							{t("ocr.instructionsHint")}
						</span>
						<textarea
							aria-label={t("ocr.instructions")}
							disabled={busy}
							value={instructions ?? ocrInstructions({ local, grounding })}
							onChange={(event) => {
								const value = event.target.value;
								setInstructions(value);
								try {
									localStorage.setItem(instructionKey, value);
								} catch {
									/* Session-only when storage is unavailable. */
								}
							}}
							className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
						/>
					</label>
					{instructions !== null ? (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => {
								setInstructions(null);
								try {
									localStorage.removeItem(instructionKey);
								} catch {
									/* Session-only when storage is unavailable. */
								}
							}}
						>
							{t("ocr.defaultInstructions")}
						</Button>
					) : null}
				</details>
				{error ? (
					<p
						role="alert"
						className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
					>
						{error}
					</p>
				) : null}
				{progress ? (
					<div
						role="status"
						aria-live="polite"
						className="flex items-center gap-2 text-sm"
					>
						<Loader2 size={16} className="animate-spin" />
						{t("ocr.progress", progress)}
					</div>
				) : null}
				{blocks.length ? <OCRBlockLegend blocks={blocks} /> : null}
				{grounding && text && !blocks.length ? (
					<p className="text-xs text-muted-foreground">{t("ocr.noLayout")}</p>
				) : null}
				<div className={cn("grid flex-1 gap-4", !isNarrow && "lg:grid-cols-2")}>
					<section
						className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
						aria-label={t("ocr.document")}
					>
						<div className="flex min-h-14 flex-wrap items-center gap-2 border-b p-3">
							<FileText size={16} />
							<h3 className="mr-auto text-sm font-medium">
								{t("ocr.document")}
							</h3>
							{storedImage || preview ? (
								<div className="flex items-center gap-1">
									<Button
										size="icon"
										variant="ghost"
										aria-label={t("ocr.zoomOut")}
										disabled={zoom <= 50}
										onClick={() => setZoom((value) => Math.max(50, value - 25))}
									>
										<Minus size={14} />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										aria-label={t("ocr.fitPage")}
										onClick={() => setZoom(100)}
									>
										{zoom === 100 ? t("ocr.fit") : `${zoom}%`}
									</Button>
									<Button
										size="icon"
										variant="ghost"
										aria-label={t("ocr.zoomIn")}
										disabled={zoom >= 200}
										onClick={() =>
											setZoom((value) => Math.min(200, value + 25))
										}
									>
										<Plus size={14} />
									</Button>
								</div>
							) : null}
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => fileInput.current?.click()}
							>
								<Upload size={14} className="mr-2" />
								{t("ocr.upload")}
							</Button>
						</div>
						<input
							id={uploadId}
							ref={fileInput}
							type="file"
							accept={OCR_ACCEPT}
							className="sr-only"
							aria-label={t("ocr.upload")}
							disabled={busy}
							onChange={(event) => {
								void upload(event.target.files?.[0]);
								event.target.value = "";
							}}
						/>
						<div className="flex max-h-[70vh] min-h-72 flex-1 items-start overflow-auto bg-muted/20 p-4">
							{storedImage?.type === "image" || preview ? (
								<div
									className="relative mx-auto shrink-0"
									style={{ width: `${zoom}%` }}
								>
									{storedImage?.type === "image" ? (
										<StoredImage
											path={storedImage.image.path}
											mimeType={storedImage.image.mimeType}
											alt={selected?.content ?? t("ocr.document")}
											className="h-auto w-full"
										/>
									) : (
										<img
											src={preview!}
											alt={document?.name ?? t("ocr.document")}
											className="h-auto w-full"
										/>
									)}
									{storedImage && blocks.length > 0 ? (
										<OCRDocumentOverlay
											blocks={blocks}
											active={highlightedBlock}
											onHighlight={setHoveredBlock}
											onSelect={(index) => {
												setActiveBlock(index);
												setResultView("blocks");
											}}
										/>
									) : null}
								</div>
							) : previewLoading || opening ? (
								<Loader2
									size={24}
									className="animate-spin text-muted-foreground"
									aria-label={t("ocr.preparing")}
								/>
							) : (
								<button
									type="button"
									onClick={() => fileInput.current?.click()}
									disabled={busy}
									className="flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Upload size={28} className="text-muted-foreground" />
									<span className="text-sm font-medium">{t("ocr.drop")}</span>
									<span className="text-xs text-muted-foreground">
										{t("ocr.formats")}
									</span>
								</button>
							)}
						</div>
						{document ? (
							<div className="space-y-3 border-t p-3">
								<p
									className="truncate text-xs text-muted-foreground"
									title={document.name}
								>
									{document.name}
								</p>
								{document.pageCount > 1 ? (
									<div className="space-y-2">
										<label className="flex flex-wrap items-center gap-2 text-xs">
											<span>{t("ocr.pagesToConvert")}</span>
											<select
												aria-label={t("ocr.pagesToConvert")}
												value={pageSelection}
												disabled={busy}
												onChange={(event) =>
													setPageSelection(
														event.target.value as OCRPageSelection,
													)
												}
												className="h-8 rounded-md border bg-background px-2 text-xs"
											>
												<option value="current">{t("ocr.currentPage")}</option>
												<option value="all">{t("ocr.allPages")}</option>
												<option value="custom">{t("ocr.customPages")}</option>
											</select>
										</label>
										{pageSelection === "custom" ? (
											<Input
												aria-label={t("ocr.pageNumbers")}
												aria-invalid={Boolean(selection.error)}
												aria-describedby={`${uploadId}-selection`}
												placeholder={t("ocr.pageRangePlaceholder")}
												value={customPages}
												disabled={busy}
												onChange={(event) => setCustomPages(event.target.value)}
												className="h-8 text-sm"
											/>
										) : null}
										<p
											id={`${uploadId}-selection`}
											className={cn(
												"text-xs",
												selection.error
													? "text-destructive"
													: "text-muted-foreground",
											)}
											role={selection.error ? "alert" : "status"}
										>
											{selection.error ??
												t("ocr.selectedPages", {
													count: selection.pages.length,
												})}
										</p>
									</div>
								) : null}
								<div className="flex flex-wrap items-center gap-2">
									{document.pageCount > 1 ? (
										<>
											<Button
												size="icon"
												variant="ghost"
												aria-label={t("ocr.previous")}
												disabled={busy || page === 1}
												onClick={() => {
													setPage(page - 1);
													setSelectedId("input");
												}}
											>
												<ChevronLeft size={16} />
											</Button>
											<span className="text-xs">
												{t("ocr.page", { page, total: document.pageCount })}
											</span>
											<Button
												size="icon"
												variant="ghost"
												aria-label={t("ocr.next")}
												disabled={busy || page === document.pageCount}
												onClick={() => {
													setPage(page + 1);
													setSelectedId("input");
												}}
											>
												<ChevronRight size={16} />
											</Button>
										</>
									) : null}
									{progress ? (
										<Button
											variant="outline"
											className="ml-auto"
											onClick={() => controllerRef.current?.abort()}
										>
											<Square size={14} className="mr-2" />
											{t("common.stop")}
										</Button>
									) : (
										<Button
											className="ml-auto"
											disabled={
												busy ||
												previewLoading ||
												!preview ||
												Boolean(selection.error) ||
												!selection.pages.length
											}
											onClick={() => void extract()}
										>
											<ScanText size={14} className="mr-2" />
											{t("ocr.extract")}
										</Button>
									)}
								</div>
							</div>
						) : null}
					</section>
					<section
						className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background"
						aria-label={t("ocr.result")}
					>
						<div className="flex min-h-14 flex-wrap items-center gap-2 border-b p-3">
							<h3 className="mr-auto text-sm font-medium">{t("ocr.result")}</h3>
							{items.length > 0 ? (
								<select
									aria-label={t("ocr.results")}
									value={selected?.id ?? "input"}
									onChange={(event) => setSelectedId(event.target.value)}
									className="h-8 max-w-full rounded-md border bg-background px-2 text-xs"
								>
									<option value="input">{t("ocr.newDocument")}</option>
									{items.map((item) => (
										<option key={item.id} value={item.id}>
											{item.content} ·{" "}
											{t("ocr.pageLabel", {
												page: item.generation.params?.pageNumber ?? 1,
											})}{" "}
											· {item.generation.modelId} · {item.generation.status}
										</option>
									))}
								</select>
							) : null}
						</div>
						{text ? (
							<>
								<Tabs
									value={view}
									onValueChange={setResultView}
									className="flex flex-1 flex-col p-3"
								>
									<TabsList className="h-auto w-fit max-w-full flex-wrap justify-start">
										{blocks.length ? (
											<TabsTrigger value="blocks">
												{t("ocr.blocks")}
											</TabsTrigger>
										) : null}
										<TabsTrigger value="preview">
											{t("ocr.documentView")}
										</TabsTrigger>
										<TabsTrigger value="markdown">{t("ocr.raw")}</TabsTrigger>
										<TabsTrigger value="data">{t("ocr.data")}</TabsTrigger>
									</TabsList>
									<TabsContent
										value="blocks"
										className="max-h-[70vh] flex-1 overflow-auto p-1"
									>
										<OCRBlocks
											blocks={blocks}
											active={highlightedBlock}
											onHighlight={setHoveredBlock}
											onSelect={(index) => {
												setActiveBlock(index);
												rootRef.current
													?.querySelector(`[data-ocr-box="${index}"]`)
													?.scrollIntoView?.({
														block: "nearest",
														behavior: "smooth",
													});
											}}
										/>
									</TabsContent>
									<TabsContent
										value="preview"
										className="prose prose-sm max-w-none flex-1 overflow-x-auto break-words dark:prose-invert"
									>
										<OCRPreview markdown={markdown} />
									</TabsContent>
									<TabsContent value="markdown" className="flex-1">
										<textarea
											readOnly
											aria-label={t("ocr.markdown")}
											value={text}
											className="min-h-80 w-full resize-y rounded-md border bg-muted/20 p-3 font-mono text-xs leading-6"
										/>
									</TabsContent>
									<TabsContent value="data" className="flex-1">
										<textarea
											readOnly
											aria-label={t("ocr.data")}
											value={json}
											className="min-h-80 w-full resize-y rounded-md border bg-muted/20 p-3 font-mono text-xs leading-6"
										/>
									</TabsContent>
								</Tabs>
								<div className="flex flex-wrap items-center gap-1 border-t p-2">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											void navigator.clipboard
												.writeText(
													view === "data"
														? json
														: view === "markdown"
															? text
															: markdown,
												)
												.then(() => setCopied(true))
												.catch((cause) => setError(String(cause)));
										}}
									>
										{copied ? (
											<Check size={14} className="mr-2" />
										) : (
											<Copy size={14} className="mr-2" />
										)}
										{t(copied ? "common.copied" : "common.copy")}
									</Button>
									<select
										aria-label={t("ocr.exportFormat")}
										value={fileFormat}
										onChange={(event) =>
											setFileFormat(event.target.value as OCRFileFormat)
										}
										className="h-8 rounded-md border bg-background px-2 text-xs"
									>
										<option value="markdown">Markdown (.md)</option>
										<option value="json">JSON (.json)</option>
										<option value="html">HTML (.html)</option>
									</select>
									<Button size="sm" variant="ghost" onClick={download}>
										<Download size={14} className="mr-2" />
										{t("common.download")}
									</Button>
									{output ? (
										<SaveToFilesAction
											key={output.fileName}
											fileName={output.fileName}
											mimeType={output.mimeType}
											content={output.content}
										/>
									) : null}
								</div>
							</>
						) : (
							<div className="flex min-h-80 flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
								<ScanText size={32} />
								<p className="text-sm">
									{selected?.generation.status === "failed"
										? selected.generation.error
										: selected?.generation.status === "cancelled"
											? t("ocr.stopped")
											: selected?.generation.status === "running"
												? t("common.running")
												: t("ocr.emptyResult")}
								</p>
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
