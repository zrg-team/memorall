import React, { useCallback, useMemo, useState } from "react";
import { Loader } from "./Icons";
import { captureScreenshotWithFallback } from "../utils/screenshot-helpers";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { sendMessageToBackground } from "../messaging";
import { isImageContextKind } from "@/embedded/context-items";
import type { EmbeddedContextItem } from "@/embedded/types";
import { logWarn } from "@/utils/logger";

export const EmbeddedContextSections: React.FC<{
	availableContexts: EmbeddedContextItem[];
	attachedContexts: EmbeddedContextItem[];
	onAttachContext: (item: EmbeddedContextItem) => void;
	onRemoveAttachedContext: (itemId: string) => void;
	onClearAttachedContexts: () => void;
	onStartSmartSelect: () => void;
	onStartCanvasSelect: () => void;
	showContextSection: boolean;
	onToggleContextSection: () => void;
}> = ({
	availableContexts,
	attachedContexts,
	onAttachContext,
	onRemoveAttachedContext,
	onClearAttachedContexts,
	onStartSmartSelect,
	onStartCanvasSelect,
	showContextSection,
	onToggleContextSection,
}) => {
	const t = useEmbeddedTranslation("contextSection");
	const [capturingContextId, setCapturingContextId] = useState<string | null>(
		null,
	);
	const [previewContextId, setPreviewContextId] = useState<string | null>(null);
	const [documentFolders, setDocumentFolders] = useState<string[]>(["/"]);
	const [selectedFolderPath, setSelectedFolderPath] = useState("/");
	const [saveFileName, setSaveFileName] = useState("");
	const [showSaveOptions, setShowSaveOptions] = useState(false);
	const [isSavingPreview, setIsSavingPreview] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
	const saveOptionsRef = React.useRef<HTMLDivElement | null>(null);

	const previewContext = useMemo(() => {
		if (!previewContextId) {
			return null;
		}

		return [...attachedContexts, ...availableContexts].find(
			(contextItem) => contextItem.id === previewContextId,
		);
	}, [attachedContexts, availableContexts, previewContextId]);

	const inferFileMeta = useCallback((contextItem: EmbeddedContextItem) => {
		const pageTitleSlug = (document.title || "page")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		const labelSlug = contextItem.label
			.replace(/^[^:]+:\s*/, "")
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 60)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		const isPageLevelContext =
			contextItem.kind === "full_page" ||
			contextItem.kind === "full_page_html" ||
			contextItem.kind === "viewport" ||
			contextItem.kind === "viewport_html" ||
			contextItem.kind === "viewport_screenshot" ||
			contextItem.kind === "screenshot";
		const slug = (isPageLevelContext ? pageTitleSlug : labelSlug) || "context";

		if (
			contextItem.kind === "smart_html" ||
			contextItem.kind === "smart_clean_html" ||
			contextItem.kind === "viewport_html" ||
			contextItem.kind === "full_page_html"
		) {
			return { fileName: `${slug}.html`, mimeType: "text/html" };
		}

		if (isImageContextKind(contextItem.kind)) {
			return { fileName: `${slug}.png`, mimeType: "image/png" };
		}

		return { fileName: `${slug}.txt`, mimeType: "text/plain" };
	}, []);

	React.useEffect(() => {
		if (!previewContext) {
			setSaveError(null);
			setSaveSuccess(null);
			return;
		}

		const { fileName } = inferFileMeta(previewContext);
		setSaveFileName(fileName);
		setShowSaveOptions(false);
		setSaveError(null);
		setSaveSuccess(null);

		let isMounted = true;
		void sendMessageToBackground<{
			success: boolean;
			error?: string;
			folders?: string[];
		}>({
			type: "GET_DOCUMENT_FOLDERS",
		})
			.then((response) => {
				if (!isMounted) return;
				const folders =
					response.success && Array.isArray(response.folders)
						? response.folders
						: ["/"];
				setDocumentFolders(folders);
				setSelectedFolderPath((current) =>
					folders.includes(current) ? current : "/",
				);
			})
			.catch((error) => {
				logWarn("Failed to load document folders:", error);
				if (!isMounted) return;
				setDocumentFolders(["/"]);
				setSelectedFolderPath("/");
			});

		return () => {
			isMounted = false;
		};
	}, [inferFileMeta, previewContext]);

	React.useEffect(() => {
		if (!showSaveOptions) {
			return;
		}

		saveOptionsRef.current?.scrollIntoView({
			block: "nearest",
			behavior: "smooth",
		});
	}, [showSaveOptions]);

	const handleAttachContext = useCallback(
		async (contextItem: EmbeddedContextItem) => {
			if (isImageContextKind(contextItem.kind) && !contextItem.content) {
				setCapturingContextId(contextItem.id);
				try {
					if (contextItem.kind === "viewport_screenshot") {
						const canvas = await captureScreenshotWithFallback(
							document.documentElement,
							{
								x: window.scrollX,
								y: window.scrollY,
								width: window.innerWidth,
								height: window.innerHeight,
								scrollX: 0,
								scrollY: 0,
							},
						);

						onAttachContext({
							...contextItem,
							content: canvas.toDataURL("image/png"),
						});
						return;
					}

					const fullHeight = document.documentElement.scrollHeight;
					const fullWidth = document.documentElement.scrollWidth;
					const chunkHeight = 1500;
					const screenshots: string[] = [];
					const numChunks = Math.ceil(fullHeight / chunkHeight);

					for (let index = 0; index < numChunks; index += 1) {
						const yOffset = index * chunkHeight;
						const captureHeight = Math.min(chunkHeight, fullHeight - yOffset);
						const canvas = await captureScreenshotWithFallback(
							document.documentElement,
							{
								x: 0,
								y: yOffset,
								width: fullWidth,
								height: captureHeight,
								scrollX: 0,
								scrollY: 0,
							},
						);
						screenshots.push(canvas.toDataURL("image/png"));
					}

					onAttachContext({
						...contextItem,
						content: screenshots.join("|||CHUNK|||"),
					});
				} catch (error) {
					logWarn("Failed to capture screenshot:", error);
				} finally {
					setCapturingContextId(null);
				}
				return;
			}

			onAttachContext(contextItem);
		},
		[onAttachContext],
	);

	const getImageSources = useCallback((contextItem: EmbeddedContextItem) => {
		if (!isImageContextKind(contextItem.kind) || !contextItem.content) {
			return [];
		}

		if (contextItem.kind === "screenshot") {
			return contextItem.content.split("|||CHUNK|||");
		}

		return [contextItem.content];
	}, []);

	const getDisplayLabel = useCallback((contextItem: EmbeddedContextItem) => {
		if (contextItem.kind !== "smart_text") {
			return contextItem.label;
		}

		return contextItem.label.replace(/^([^:]+:\s*)<[^>]+>\s*/, "$1");
	}, []);

	/**
	 * Keeps a wheel over the preview from also scrolling the conversation behind
	 * it. Chaining out to the host page is handled by `overscroll-contain` on the
	 * preview itself.
	 *
	 * See the note in `use-conversation-auto-scroll`: the `preventDefault` this
	 * used to call at the scroll boundary was silently ignored, because React
	 * registers `wheel` as a passive listener, and it logged a console warning on
	 * the host page for every wheel event once the preview was scrolled to an
	 * edge.
	 */
	const handleScrollableWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			event.stopPropagation();
		},
		[],
	);

	const handleSavePreview = useCallback(async () => {
		if (!previewContext || !saveFileName.trim()) {
			return;
		}

		setIsSavingPreview(true);
		setSaveError(null);
		setSaveSuccess(null);

		try {
			const targetFolder = selectedFolderPath || "/";
			if (isImageContextKind(previewContext.kind)) {
				const sources = getImageSources(previewContext);
				const response = await sendMessageToBackground<{
					success: boolean;
					error?: string;
				}>({
					type: "SAVE_EMBEDDED_CONTEXT_PREVIEW",
					folderPath: targetFolder,
					fileName: saveFileName.trim(),
					imageSources: sources,
				});

				if (!response.success) {
					throw new Error(response.error || t("failedToSave"));
				}

				setSaveSuccess(
					sources.length > 1
						? t("imageFilesSaved", { count: sources.length })
						: t("imageSaved"),
				);
				return;
			}

			const { mimeType } = inferFileMeta(previewContext);
			const response = await sendMessageToBackground<{
				success: boolean;
				error?: string;
			}>({
				type: "SAVE_EMBEDDED_CONTEXT_PREVIEW",
				folderPath: targetFolder,
				fileName: saveFileName.trim(),
				mimeType,
				content: previewContext.content,
			});

			if (!response.success) {
				throw new Error(response.error || t("failedToSave"));
			}
			setSaveSuccess(t("saveToDocuments"));
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : t("failedToSave"));
		} finally {
			setIsSavingPreview(false);
		}
	}, [
		getImageSources,
		inferFileMeta,
		previewContext,
		saveFileName,
		selectedFolderPath,
		t,
	]);

	return (
		<>
			{(availableContexts.length > 0 || attachedContexts.length > 0) && (
				<div className="memorall-context-section">
					<div className="memorall-context-header">
						<div className="memorall-context-title-wrap">
							<button
								onClick={onToggleContextSection}
								className="memorall-context-toggle"
								title={
									showContextSection
										? t("hideContextSection")
										: t("showContextSection")
								}
								onKeyDown={(e) => e.stopPropagation()}
								onKeyUp={(e) => e.stopPropagation()}
								onKeyPress={(e) => e.stopPropagation()}
							>
								<svg
									className="memorall-context-toggle-icon"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d={showContextSection ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"}
									/>
								</svg>
							</button>
							<div className="memorall-context-title">{t("selectContext")}</div>
						</div>

						<div className="memorall-context-actions">
							<button
								onClick={onStartSmartSelect}
								className="memorall-smart-select-button"
								onKeyDown={(e) => e.stopPropagation()}
								onKeyUp={(e) => e.stopPropagation()}
								onKeyPress={(e) => e.stopPropagation()}
							>
								<svg
									className="memorall-smart-select-icon"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 6.364l-2.121-2.121M8.757 8.757L6.636 6.636m11.728 0l-2.121 2.121M8.757 15.243l-2.121 2.121"
									/>
								</svg>
								{t("smartSelect")}
							</button>
							<button
								onClick={onStartCanvasSelect}
								className="memorall-smart-select-button"
								onKeyDown={(e) => e.stopPropagation()}
								onKeyUp={(e) => e.stopPropagation()}
								onKeyPress={(e) => e.stopPropagation()}
							>
								<svg
									className="memorall-smart-select-icon"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 3v13a2 2 0 002 2h13M3 6h13a2 2 0 012 2v13"
									/>
								</svg>
								{t("canvasSelect")}
							</button>
							{attachedContexts.length > 0 && (
								<button
									onClick={onClearAttachedContexts}
									className="text-xs text-muted-foreground hover:text-foreground transition-colors"
									onKeyDown={(e) => e.stopPropagation()}
									onKeyUp={(e) => e.stopPropagation()}
									onKeyPress={(e) => e.stopPropagation()}
								>
									{t("clearAll")}
								</button>
							)}
						</div>
					</div>

					{showContextSection && availableContexts.length > 0 && (
						<div className="memorall-context-group">
							<div className="memorall-context-grid">
								{availableContexts.map((contextItem) => {
									const isCapturing = capturingContextId === contextItem.id;
									const canPreview =
										Boolean(contextItem.content) && !isCapturing;

									return (
										<div key={contextItem.id} className="memorall-context-tile">
											<button
												type="button"
												onClick={() => void handleAttachContext(contextItem)}
												disabled={isCapturing}
												className={`memorall-context-attach-button ${
													isCapturing ? "opacity-60 cursor-wait" : ""
												}`}
												onKeyDown={(e) => e.stopPropagation()}
												onKeyUp={(e) => e.stopPropagation()}
												onKeyPress={(e) => e.stopPropagation()}
											>
												<span className="memorall-context-label">
													{getDisplayLabel(contextItem)}
												</span>
												{isCapturing ? (
													<Loader size={12} />
												) : (
													<span className="memorall-context-attach-text">
														{t("attach")}
													</span>
												)}
											</button>
											{canPreview && (
												<button
													type="button"
													onClick={() => setPreviewContextId(contextItem.id)}
													className="memorall-context-preview-button"
													title={t("preview")}
													onKeyDown={(e) => e.stopPropagation()}
													onKeyUp={(e) => e.stopPropagation()}
													onKeyPress={(e) => e.stopPropagation()}
												>
													<svg
														className="h-3.5 w-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth={2}
															d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
														/>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth={2}
															d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
														/>
													</svg>
												</button>
											)}
										</div>
									);
								})}
							</div>
						</div>
					)}

					{attachedContexts.length > 0 && (
						<div className="memorall-context-group">
							<div className="memorall-attached-title">
								{t("attachedContexts")}
							</div>
							<div className="memorall-context-grid memorall-context-grid--attached">
								{attachedContexts.map((contextItem) => (
									<div
										key={contextItem.id}
										className="memorall-context-tile memorall-context-tile--attached"
									>
										<div className="memorall-context-attached-label-wrap">
											<div className="memorall-context-label">
												{getDisplayLabel(contextItem)}
											</div>
										</div>
										<button
											type="button"
											onClick={() => setPreviewContextId(contextItem.id)}
											className="memorall-context-preview-button"
											title={t("preview")}
											onKeyDown={(e) => e.stopPropagation()}
											onKeyUp={(e) => e.stopPropagation()}
											onKeyPress={(e) => e.stopPropagation()}
										>
											<svg
												className="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
												/>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
												/>
											</svg>
										</button>
										<button
											type="button"
											onClick={() => {
												if (previewContextId === contextItem.id) {
													setPreviewContextId(null);
												}
												onRemoveAttachedContext(contextItem.id);
											}}
											className="memorall-context-preview-button"
											title={t("removeAttachment")}
											onKeyDown={(e) => e.stopPropagation()}
											onKeyUp={(e) => e.stopPropagation()}
											onKeyPress={(e) => e.stopPropagation()}
										>
											<svg
												className="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</div>
								))}
							</div>
						</div>
					)}

					{previewContext && (
						<div className="rounded-lg border border-border bg-background shadow-sm">
							<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
								<div className="min-w-0">
									<div className="truncate text-xs font-medium text-foreground">
										{getDisplayLabel(previewContext)}
									</div>
									<div className="text-[10px] text-muted-foreground">
										{isImageContextKind(previewContext.kind)
											? t("imagePreview")
											: t("charCount", {
													count: previewContext.content.length.toLocaleString(),
												})}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setShowSaveOptions((prev) => !prev)}
										className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
										onKeyDown={(e) => e.stopPropagation()}
										onKeyUp={(e) => e.stopPropagation()}
										onKeyPress={(e) => e.stopPropagation()}
									>
										<svg
											className="h-3.5 w-3.5"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
											/>
										</svg>
										{t("saveToDocuments")}
									</button>
									<button
										type="button"
										onClick={() => setPreviewContextId(null)}
										className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
										onKeyDown={(e) => e.stopPropagation()}
										onKeyUp={(e) => e.stopPropagation()}
										onKeyPress={(e) => e.stopPropagation()}
									>
										{t("closePreview")}
									</button>
								</div>
							</div>
							{showSaveOptions && (
								<div
									ref={saveOptionsRef}
									className="border-b border-border px-3 py-3 space-y-2 bg-muted/20"
								>
									<div className="grid gap-2 sm:grid-cols-2">
										<label className="space-y-1">
											<div className="text-[11px] font-medium text-muted-foreground">
												{t("saveFolder")}
											</div>
											<select
												value={selectedFolderPath}
												onChange={(e) => setSelectedFolderPath(e.target.value)}
												className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
												onKeyDown={(e) => e.stopPropagation()}
												onKeyUp={(e) => e.stopPropagation()}
												onKeyPress={(e) => e.stopPropagation()}
											>
												{documentFolders.map((folderPath) => (
													<option key={folderPath} value={folderPath}>
														{folderPath}
													</option>
												))}
											</select>
										</label>
										<label className="space-y-1">
											<div className="text-[11px] font-medium text-muted-foreground">
												{t("saveFileName")}
											</div>
											<input
												value={saveFileName}
												onChange={(e) => setSaveFileName(e.target.value)}
												className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
												onKeyDown={(e) => e.stopPropagation()}
												onKeyUp={(e) => e.stopPropagation()}
												onKeyPress={(e) => e.stopPropagation()}
											/>
										</label>
									</div>
									<div className="flex items-center justify-between gap-2">
										<div className="min-h-[16px] text-[11px]">
											{saveError ? (
												<span className="text-destructive">{saveError}</span>
											) : saveSuccess ? (
												<span className="text-emerald-600">{saveSuccess}</span>
											) : null}
										</div>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => setShowSaveOptions(false)}
												className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
												onKeyDown={(e) => e.stopPropagation()}
												onKeyUp={(e) => e.stopPropagation()}
												onKeyPress={(e) => e.stopPropagation()}
											>
												{t("closePreview")}
											</button>
											<button
												type="button"
												onClick={() => void handleSavePreview()}
												disabled={isSavingPreview || !saveFileName.trim()}
												className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
												onKeyDown={(e) => e.stopPropagation()}
												onKeyUp={(e) => e.stopPropagation()}
												onKeyPress={(e) => e.stopPropagation()}
											>
												{isSavingPreview
													? t("savingToDocuments")
													: t("saveToDocuments")}
											</button>
										</div>
									</div>
								</div>
							)}
							<div
								className="max-h-72 overflow-auto overscroll-contain p-3"
								onWheel={handleScrollableWheel}
							>
								{isImageContextKind(previewContext.kind) ? (
									<div className="grid gap-2">
										{getImageSources(previewContext).map((src, index) => (
											<img
												key={`${previewContext.id}-${index}`}
												src={src}
												alt={`${previewContext.label} ${index + 1}`}
												className="w-full rounded border border-border object-cover"
											/>
										))}
									</div>
								) : (
									<pre className="whitespace-pre-wrap break-words text-xs text-foreground">
										{previewContext.content}
									</pre>
								)}
							</div>
						</div>
					)}
				</div>
			)}
		</>
	);
};
