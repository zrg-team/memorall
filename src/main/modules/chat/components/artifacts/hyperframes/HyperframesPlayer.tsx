import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	Check,
	Download,
	Loader2,
	Send,
	SlidersHorizontal,
	Square,
	X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import type { NormalizedComposition } from "./composition-html";

const PREVIEW_PAGE = "sandbox/pages/hyperframes-preview.html";
/**
 * Its place among manifest.base.json's sandbox pages. Extension builds rename
 * those to sandbox/page-N.html, and only the listed copy gets the sandbox
 * policy that lets the composition's inline timeline run; the same file at
 * its own path is an ordinary extension page that blocks it.
 */
export const HYPERFRAMES_PREVIEW_PAGE_INDEX = 2;

const previewPageUrl = (): string =>
	platform.assets.sandboxPageUrl(PREVIEW_PAGE, HYPERFRAMES_PREVIEW_PAGE_INDEX);

type HyperframesPlayerElement = HTMLElement & {
	iframeElement?: HTMLIFrameElement;
	play?: () => void;
	pause?: () => void;
	paused?: boolean;
	ready?: boolean;
};

type ExportPhase =
	| "idle"
	| "preparing"
	| "exporting"
	| "saving"
	| "complete"
	| "failed";

type ExportState = {
	phase: ExportPhase;
	frame?: number;
	total?: number;
	error?: string;
};

export type ExportFps = 24 | 25 | 30 | 60;
export type ExportQuality = "standard" | "high" | "max";
export type ExportSize = "native" | "720p" | "1080p" | "1440p" | "2160p";

export type ExportSettings = {
	fps: ExportFps;
	quality: ExportQuality;
	size: ExportSize;
};

export interface HyperframesExport {
	blob: Blob;
	filename: string;
	/** The export request it answers, when it was not the user's click. */
	requestId?: number;
}

/** An export asked for from outside the player (the agent, through MemonOS). */
export interface HyperframesExportRequest {
	id: number;
	settings?: Partial<ExportSettings>;
}

type ExportResult = {
	url: string;
	filename: string;
	/** Where the MP4 was saved in Files, when the host saved it. */
	savedPath?: string;
	saveError?: string;
};

type PreviewIssue = {
	kind: string;
	message: string;
	details?: Record<string, unknown>;
};

const MAX_PREVIEW_ISSUES = 8;
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	fps: 30,
	quality: "high",
	size: "native",
};
const EXPORT_FPS_OPTIONS: ExportFps[] = [24, 25, 30, 60];
const EXPORT_QUALITY_OPTIONS: { value: ExportQuality; labelKey: string }[] = [
	{ value: "max", labelKey: "qualityMax" },
	{ value: "high", labelKey: "qualityHigh" },
	{ value: "standard", labelKey: "qualityStandard" },
];
const EXPORT_SIZE_OPTIONS: {
	value: ExportSize;
	label: string;
	labelKey?: string;
}[] = [
	{ value: "native", label: "Native", labelKey: "sizeNative" },
	{ value: "720p", label: "720p" },
	{ value: "1080p", label: "1080p" },
	{ value: "1440p", label: "1440p" },
	{ value: "2160p", label: "2160p" },
];

const SELECT =
	"h-8 rounded-md border border-white/15 bg-black px-2 text-white outline-none focus:border-white/35";
const TOOL_BUTTON =
	"inline-flex h-8 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 disabled:cursor-progress disabled:opacity-60";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

const toPreviewIssue = (value: unknown): PreviewIssue | null => {
	if (!isRecord(value)) return null;
	const message = typeof value.message === "string" ? value.message : "";
	if (!message.trim()) return null;
	return {
		kind: typeof value.kind === "string" ? value.kind : "runtime",
		message,
		details: isRecord(value.details) ? value.details : undefined,
	};
};

export const formatPreviewIssue = (issue: PreviewIssue): string => {
	const source =
		typeof issue.details?.source === "string" ? issue.details.source : "";
	const line =
		typeof issue.details?.line === "number" ? `:${issue.details.line}` : "";
	const location = source ? ` (${source}${line})` : "";
	return `[${issue.kind}] ${issue.message}${location}`;
};

let hyperframesPlayerLoad: Promise<void> | null = null;

const ensureHyperframesPlayer = (): Promise<void> => {
	if (customElements.get("hyperframes-player")) return Promise.resolve();
	hyperframesPlayerLoad ??= new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = platform.assets.url(
			"vendors/hyperframes/hyperframes-player.global.js",
		);
		script.onload = () => resolve();
		script.onerror = () => {
			hyperframesPlayerLoad = null;
			reject(new Error("Failed to load HyperFrames player"));
		};
		document.head.appendChild(script);
	});
	return hyperframesPlayerLoad;
};

const downloadUrl = (url: string, filename: string) => {
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
};

export interface HyperframesPlayerProps {
	composition: NormalizedComposition;
	title?: string;
	/** The exported MP4's file name, without extension. */
	filenameBase: string;
	/** Width over height, for the player box before it loads. */
	aspectRatio?: number;
	/** "inline": sized by its aspect ratio, capped in height. "fill": fills its parent. */
	layout?: "inline" | "fill";
	autoplay?: boolean;
	/** False pauses playback: the preview scrolled away or its window is hidden. */
	active?: boolean;
	/**
	 * Keeps the exported MP4, e.g. saves it into the project; returns the
	 * path it was saved to. The MP4 is offered for download either way.
	 */
	onExported?: (result: HyperframesExport) => Promise<string | undefined>;
	/** Sends the preview's runtime errors to whoever can fix them. */
	onReportIssues?: (issues: string[]) => void;
	/** Starts an export once the player is ready, once per request id. */
	exportRequest?: HyperframesExportRequest;
	onExportRequestStarted?: (id: number) => void;
	onExportRequestFailed?: (id: number, error: string) => void;
	/** Shown at the start of the toolbar. */
	toolbarStart?: React.ReactNode;
	className?: string;
}

/**
 * A HyperFrames composition playing in the HyperFrames player, with MP4
 * export. The composition runs in a manifest sandbox page (its own origin,
 * packaged runtimes only); everything here talks to it by postMessage.
 */
export const HyperframesPlayer: React.FC<HyperframesPlayerProps> = ({
	composition,
	title,
	filenameBase,
	aspectRatio,
	layout = "inline",
	autoplay = true,
	active = true,
	onExported,
	onReportIssues,
	exportRequest,
	onExportRequestStarted,
	onExportRequestFailed,
	toolbarStart,
	className,
}) => {
	const { t } = useTranslation("chat");
	const containerRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<HyperframesPlayerElement | null>(null);
	const keyRef = useRef<string | null>(null);
	const resultRef = useRef<ExportResult | null>(null);
	const activeRef = useRef(active);
	const autoplayRef = useRef(autoplay);
	const onExportedRef = useRef(onExported);
	onExportedRef.current = onExported;
	const requestCallbacksRef = useRef({
		started: onExportRequestStarted,
		failed: onExportRequestFailed,
	});
	requestCallbacksRef.current = {
		started: onExportRequestStarted,
		failed: onExportRequestFailed,
	};
	/** The request the running export answers; undefined for the user's click. */
	const runningRequestRef = useRef<number | undefined>(undefined);
	const handledRequestRef = useRef<number | undefined>(undefined);
	const failRunningRequest = useCallback((error: string) => {
		const id = runningRequestRef.current;
		runningRequestRef.current = undefined;
		if (id !== undefined) requestCallbacksRef.current.failed?.(id, error);
	}, []);
	activeRef.current = active;
	autoplayRef.current = autoplay;
	const [ready, setReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [exportState, setExportState] = useState<ExportState>({
		phase: "idle",
	});
	const [result, setResult] = useState<ExportResult | null>(null);
	const [previewIssues, setPreviewIssues] = useState<PreviewIssue[]>([]);
	const [showSettings, setShowSettings] = useState(false);
	const [settings, setSettings] = useState<ExportSettings>(
		DEFAULT_EXPORT_SETTINGS,
	);

	const clearResult = useCallback(() => {
		const previous = resultRef.current;
		if (previous) URL.revokeObjectURL(previous.url);
		resultRef.current = null;
		setResult(null);
	}, []);

	useEffect(() => () => clearResult(), [clearResult]);

	const finishExport = useCallback(
		async (blob: Blob, filename: string) => {
			clearResult();
			const next: ExportResult = { url: URL.createObjectURL(blob), filename };
			resultRef.current = next;
			setShowSettings(false);
			const requestId = runningRequestRef.current;
			runningRequestRef.current = undefined;
			const keep = onExportedRef.current;
			if (keep) {
				setExportState({ phase: "saving" });
				try {
					next.savedPath = await keep({ blob, filename, requestId });
				} catch (error) {
					next.saveError =
						error instanceof Error ? error.message : String(error);
					if (requestId !== undefined) {
						requestCallbacksRef.current.failed?.(requestId, next.saveError);
					}
				}
			}
			if (resultRef.current !== next) return;
			setResult({ ...next });
			setExportState({ phase: "complete" });
		},
		[clearResult],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let cancelled = false;
		let removeListeners: (() => void) | null = null;
		clearResult();
		setReady(false);
		setLoadError(null);
		setExportState({ phase: "idle" });
		setPreviewIssues([]);
		const key = `memorall-hyperframes:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
		keyRef.current = key;
		const pageUrl = new URL(previewPageUrl());
		pageUrl.hash = `composition=${encodeURIComponent(key)}`;

		void ensureHyperframesPlayer()
			.then(() => {
				if (cancelled) return;
				container.textContent = "";
				const player = document.createElement(
					"hyperframes-player",
				) as HyperframesPlayerElement;
				player.setAttribute("controls", "");
				player.setAttribute("muted", "");
				if (autoplayRef.current && activeRef.current) {
					player.setAttribute("autoplay", "");
				}
				player.style.cssText = "display:block;width:100%;height:100%";
				container.appendChild(player);
				playerRef.current = player;

				const onReady = () => setReady(true);
				player.addEventListener("ready", onReady);

				// The page asks for the composition every 100 ms until it has it,
				// so one listener covers every load order.
				const onMessage = (event: MessageEvent): void => {
					const data = event.data;
					if (!isRecord(data) || data.key !== key) return;
					if (data.type === "memorall:hyperframes-composition-ready") {
						try {
							player.iframeElement?.contentWindow?.postMessage(
								{
									type: "memorall:hyperframes-composition",
									key,
									html: composition.html,
									inlineScripts: composition.inlineScripts,
									filenameBase,
								},
								"*",
							);
						} catch {
							// Still navigating: the page asks again.
						}
						return;
					}
					if (data.type === "memorall:hyperframes-preview-event") {
						const previewEvent = isRecord(data.event) ? data.event : null;
						if (previewEvent?.type !== "preview.error") return;
						const issue = toPreviewIssue(previewEvent.payload);
						if (!issue) return;
						setPreviewIssues((previous) => {
							const label = formatPreviewIssue(issue);
							if (previous.some((item) => formatPreviewIssue(item) === label)) {
								return previous;
							}
							return [...previous, issue].slice(-MAX_PREVIEW_ISSUES);
						});
						return;
					}
					if (data.type !== "memorall:hyperframes-export-status") return;
					const status = data.status;
					if (status === "idle" || status === "cancelled") {
						setReady(true);
						setExportState({ phase: "idle" });
						if (status === "cancelled") {
							failRunningRequest("The export was cancelled.");
						}
					} else if (status === "preparing" || status === "busy") {
						setExportState({ phase: "preparing" });
					} else if (status === "exporting") {
						setExportState({
							phase: "exporting",
							frame: typeof data.frame === "number" ? data.frame : undefined,
							total: typeof data.total === "number" ? data.total : undefined,
						});
					} else if (status === "complete" && data.blob instanceof Blob) {
						void finishExport(
							data.blob,
							typeof data.filename === "string"
								? data.filename
								: `${filenameBase}.mp4`,
						);
					} else if (status === "failed") {
						const error =
							typeof data.error === "string" ? data.error : "Export failed";
						setExportState({ phase: "failed", error });
						failRunningRequest(error);
					}
				};
				window.addEventListener("message", onMessage);
				removeListeners = () => {
					window.removeEventListener("message", onMessage);
					player.removeEventListener("ready", onReady);
				};

				// Last, so the listener is in place before the page loads.
				player.setAttribute("src", pageUrl.href);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setLoadError(error instanceof Error ? error.message : String(error));
				}
			});

		return () => {
			cancelled = true;
			removeListeners?.();
			playerRef.current = null;
			if (keyRef.current === key) keyRef.current = null;
			container.textContent = "";
			failRunningRequest("The video changed before its export finished.");
		};
	}, [
		clearResult,
		composition,
		failRunningRequest,
		filenameBase,
		finishExport,
	]);

	// Off screen or hidden: stop playing; back again: play if it autoplays.
	useEffect(() => {
		const player = playerRef.current;
		if (!player || !ready) return;
		if (!active) player.pause?.();
		else if (autoplay && player.paused) player.play?.();
	}, [active, autoplay, ready]);

	const postToPage = useCallback((message: Record<string, unknown>) => {
		const key = keyRef.current;
		const target = playerRef.current?.iframeElement?.contentWindow;
		if (!key || !target) return false;
		target.postMessage({ ...message, key }, "*");
		return true;
	}, []);

	const startExport = useCallback(
		(overrides?: Partial<ExportSettings>, requestId?: number): boolean => {
			clearResult();
			setShowSettings(false);
			playerRef.current?.pause?.();
			const started = postToPage({
				type: "memorall:hyperframes-export-mp4",
				filenameBase,
				options: { ...settings, ...overrides },
			});
			if (started) {
				runningRequestRef.current = requestId;
				setExportState({ phase: "preparing" });
			}
			return started;
		},
		[clearResult, filenameBase, postToPage, settings],
	);

	// An export asked for from outside: once per request, once the page is up.
	useEffect(() => {
		if (!exportRequest || !ready) return;
		if (handledRequestRef.current === exportRequest.id) return;
		const busyNow =
			exportState.phase === "preparing" ||
			exportState.phase === "exporting" ||
			exportState.phase === "saving";
		if (busyNow) return;
		handledRequestRef.current = exportRequest.id;
		if (startExport(exportRequest.settings, exportRequest.id)) {
			requestCallbacksRef.current.started?.(exportRequest.id);
		} else {
			requestCallbacksRef.current.failed?.(
				exportRequest.id,
				"The player is not ready to export.",
			);
		}
	}, [exportRequest, exportState.phase, ready, startExport]);

	const cancelExport = useCallback(() => {
		postToPage({ type: "memorall:hyperframes-export-cancel" });
	}, [postToPage]);

	const reportIssues = useCallback(() => {
		if (previewIssues.length === 0) return;
		onReportIssues?.(previewIssues.map(formatPreviewIssue));
	}, [onReportIssues, previewIssues]);

	const busy =
		exportState.phase === "preparing" ||
		exportState.phase === "exporting" ||
		exportState.phase === "saving";
	const progress =
		exportState.phase === "exporting" && exportState.total
			? Math.min(1, (exportState.frame ?? 0) / exportState.total)
			: null;
	const busyLabel =
		exportState.phase === "exporting" && exportState.total
			? t("hyperframesPreview.exportProgress", {
					frame: exportState.frame ?? 0,
					total: exportState.total,
				})
			: exportState.phase === "saving"
				? t("hyperframesPreview.exportSaving")
				: exportState.phase === "exporting"
					? t("hyperframesPreview.exportRunning")
					: t("hyperframesPreview.exportPreparing");

	const ratio =
		aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
			? aspectRatio
			: 16 / 9;

	return (
		<div
			className={cn(
				"flex flex-col overflow-hidden bg-black",
				layout === "inline" ? "rounded-md" : "h-full min-h-0",
				className,
			)}
		>
			<div
				className="border-b border-white/10 bg-black"
				data-html2canvas-ignore="true"
			>
				<div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2">
					{/* A minimum width: export status wraps to a second row rather
					    than squeezing the title away. */}
					<div className="flex min-w-[10rem] flex-1 items-center gap-2">
						{toolbarStart}
					</div>
					{busy ? (
						<>
							<span className="inline-flex items-center gap-2 text-xs text-white/80">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								{busyLabel}
							</span>
							{exportState.phase !== "saving" ? (
								<button
									type="button"
									onClick={cancelExport}
									className={TOOL_BUTTON}
									title={t("hyperframesPreview.exportCancel")}
								>
									<Square className="h-3 w-3" />
									<span>{t("hyperframesPreview.exportCancel")}</span>
								</button>
							) : null}
						</>
					) : result ? (
						<>
							<span
								className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-white/75"
								title={result.savedPath ?? result.saveError ?? result.filename}
							>
								{result.savedPath ? (
									<>
										<Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
										<span className="truncate">
											{t("hyperframesPreview.exportSaved", {
												// The file within its project; the title has it all.
												path: result.savedPath.split("/").slice(-2).join("/"),
											})}
										</span>
									</>
								) : result.saveError ? (
									<span className="truncate text-amber-200">
										{t("hyperframesPreview.exportSaveFailed")}
									</span>
								) : null}
							</span>
							<button
								type="button"
								onClick={() => downloadUrl(result.url, result.filename)}
								className={TOOL_BUTTON}
								title={result.filename}
							>
								<Download className="h-3.5 w-3.5" />
								<span>{t("hyperframesPreview.downloadMp4")}</span>
							</button>
							<button
								type="button"
								onClick={() => {
									clearResult();
									setExportState({ phase: "idle" });
									setShowSettings(true);
								}}
								className={TOOL_BUTTON}
								title={t("hyperframesPreview.exportTitle")}
							>
								<SlidersHorizontal className="h-3.5 w-3.5" />
								<span>{t("hyperframesPreview.exportAgain")}</span>
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setShowSettings((open) => !open)}
							disabled={!ready}
							className={TOOL_BUTTON}
							title={exportState.error || t("hyperframesPreview.exportTitle")}
						>
							{exportState.phase === "failed" ? (
								<AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
							) : (
								<SlidersHorizontal className="h-3.5 w-3.5" />
							)}
							<span>
								{exportState.phase === "failed"
									? t("hyperframesPreview.exportFailed")
									: t("hyperframesPreview.exportMp4")}
							</span>
						</button>
					)}
				</div>
				{progress !== null ? (
					<div className="h-0.5 w-full bg-white/10">
						<div
							className="h-full bg-white/70 transition-[width] duration-150"
							style={{ width: `${Math.round(progress * 100)}%` }}
						/>
					</div>
				) : null}
				{showSettings && !busy && !result ? (
					<div className="grid gap-2 border-t border-white/10 px-3 pb-3 pt-1 text-xs text-white sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
						<label className="grid gap-1">
							<span className="font-medium text-white/70">
								{t("hyperframesPreview.fps")}
							</span>
							<select
								value={settings.fps}
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										fps: Number(event.target.value) as ExportFps,
									}))
								}
								className={SELECT}
							>
								{EXPORT_FPS_OPTIONS.map((fps) => (
									<option key={fps} value={fps}>
										{t("hyperframesPreview.fpsOption", { fps })}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1">
							<span className="font-medium text-white/70">
								{t("hyperframesPreview.imageQuality")}
							</span>
							<select
								value={settings.quality}
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										quality: event.target.value as ExportQuality,
									}))
								}
								className={SELECT}
							>
								{EXPORT_QUALITY_OPTIONS.map((quality) => (
									<option key={quality.value} value={quality.value}>
										{t(`hyperframesPreview.${quality.labelKey}`)}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1">
							<span className="font-medium text-white/70">
								{t("hyperframesPreview.videoSize")}
							</span>
							<select
								value={settings.size}
								onChange={(event) =>
									setSettings((current) => ({
										...current,
										size: event.target.value as ExportSize,
									}))
								}
								className={SELECT}
							>
								{EXPORT_SIZE_OPTIONS.map((size) => (
									<option key={size.value} value={size.value}>
										{size.labelKey
											? t(`hyperframesPreview.${size.labelKey}`)
											: size.label}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							onClick={() => startExport()}
							className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-white/15 bg-white px-3 font-medium text-black hover:bg-white/90"
						>
							<Download className="h-3.5 w-3.5" />
							<span>{t("hyperframesPreview.startMp4")}</span>
						</button>
						<button
							type="button"
							onClick={() => setShowSettings(false)}
							className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/15"
							title={t("hyperframesPreview.closeExportSettings")}
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				) : null}
			</div>
			<div
				className={cn(
					"relative mx-auto w-full",
					layout === "fill" && "min-h-0 flex-1",
				)}
				style={
					layout === "inline"
						? {
								aspectRatio: String(ratio),
								maxHeight: "60vh",
								maxWidth: `calc(60vh * ${ratio})`,
							}
						: undefined
				}
			>
				<div
					ref={containerRef}
					className="absolute inset-0"
					aria-label={title || t("hyperframesPreview.compositionAriaLabel")}
				/>
				{!ready && !loadError ? (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/60">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : null}
				{loadError ? (
					<div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-red-200">
						{loadError}
					</div>
				) : null}
				{previewIssues.length > 0 ? (
					<div
						className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-red-400/35 bg-black/85 p-3 text-white shadow-lg backdrop-blur"
						data-html2canvas-ignore="true"
					>
						<div className="flex items-start gap-3">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
							<div className="min-w-0 flex-1">
								<div className="text-xs font-semibold text-red-100">
									{t("hyperframesPreview.previewIssue", {
										count: previewIssues.length,
									})}
								</div>
								<div className="mt-1 max-h-20 space-y-1 overflow-auto font-mono text-[11px] leading-snug text-red-100/85">
									{previewIssues.slice(-3).map((issue) => (
										<div
											key={formatPreviewIssue(issue)}
											className="truncate"
											title={formatPreviewIssue(issue)}
										>
											{formatPreviewIssue(issue)}
										</div>
									))}
								</div>
							</div>
							{onReportIssues ? (
								<button
									type="button"
									onClick={reportIssues}
									className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-red-200/25 bg-red-500/20 px-3 text-xs font-medium text-red-50 hover:bg-red-500/30"
									title={t("hyperframesPreview.sendToAgentTitle")}
								>
									<Send className="h-3.5 w-3.5" />
									<span>{t("hyperframesPreview.sendToAgent")}</span>
								</button>
							) : (
								<button
									type="button"
									onClick={() => setPreviewIssues([])}
									className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-200/25 bg-red-500/20 text-red-50 hover:bg-red-500/30"
									title={t("hyperframesPreview.dismissIssues")}
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
};
