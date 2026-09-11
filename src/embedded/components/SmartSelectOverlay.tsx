import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createEmbeddedContextItem } from "@/embedded/context-items";
import {
	getMemorallOverlayContainers,
	mountExclusiveOverlay,
	SMART_SELECT_CONTAINER_ID,
} from "./overlay-registry";
import {
	captureElementRegion,
	RegionCaptureError,
} from "@/embedded/utils/capture-region";
import {
	extractElementCleanHTML,
	extractElementOuterHTML,
	extractElementTextContent,
} from "@/embedded/content-extraction";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { EmbeddedContextItem } from "@/embedded/types";

export type SmartSelectAction =
	| "open-chat"
	| "store-to-document"
	| "open-full-chat";

interface SmartSelectOverlayProps {
	onSelectContext: (item: EmbeddedContextItem) => void;
	onAction?: (item: EmbeddedContextItem, action: SmartSelectAction) => void;
	onCancel: () => void;
	mode?: "chat" | "standalone";
}

// The co-agent dock belongs in this list too: leaving it out is what put it
// inside the images smart select captured.
const getIgnoredContainers = (): HTMLElement[] =>
	getMemorallOverlayContainers();

const isIgnoredNode = (target: EventTarget | null): boolean => {
	if (!(target instanceof Node)) {
		return false;
	}

	return getIgnoredContainers().some((container) => container.contains(target));
};

const getTargetElement = (clientX: number, clientY: number): Element | null => {
	const element = document.elementFromPoint(clientX, clientY);
	if (!element || isIgnoredNode(element)) {
		return null;
	}

	return element;
};

const describeElement = (element: Element): string => {
	const tagName = element.tagName.toLowerCase();
	const textCandidate =
		extractElementTextContent(element) ||
		element.getAttribute("aria-label") ||
		element.getAttribute("title") ||
		element.getAttribute("alt") ||
		"";
	const normalizedText = textCandidate.replace(/\s+/g, " ").trim();
	return normalizedText
		? `<${tagName}> ${normalizedText.slice(0, 48)}`
		: `<${tagName}>`;
};

const describeElementText = (element: Element): string => {
	const textCandidate =
		extractElementTextContent(element) ||
		element.getAttribute("aria-label") ||
		element.getAttribute("title") ||
		element.getAttribute("alt") ||
		element.tagName.toLowerCase();

	return textCandidate.replace(/\s+/g, " ").trim().slice(0, 48);
};

const SmartSelectOverlay: React.FC<SmartSelectOverlayProps> = ({
	onSelectContext,
	onAction,
	onCancel,
	mode = "chat",
}) => {
	const t = useEmbeddedTranslation("contextSection");
	const [hoveredElement, setHoveredElement] = useState<Element | null>(null);
	const [selectedElement, setSelectedElement] = useState<Element | null>(null);
	const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
	const [chooserPoint, setChooserPoint] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [pendingItem, setPendingItem] = useState<EmbeddedContextItem | null>(
		null,
	);
	const [isCapturing, setIsCapturing] = useState(false);
	const [captureError, setCaptureError] = useState<string | null>(null);

	const updateHighlight = useCallback((element: Element | null) => {
		setHighlightRect(element ? element.getBoundingClientRect() : null);
	}, []);

	useEffect(() => {
		const chatContainer = document.getElementById(
			"memorall-embedded-chat-modal",
		);
		if (!chatContainer) {
			return;
		}

		const previousPointerEvents = chatContainer.style.pointerEvents;
		chatContainer.style.pointerEvents = "none";

		return () => {
			chatContainer.style.pointerEvents = previousPointerEvents;
		};
	}, []);

	useEffect(() => {
		const handleMouseMove = (event: MouseEvent) => {
			if (selectedElement || isIgnoredNode(event.target)) {
				return;
			}

			const nextElement = getTargetElement(event.clientX, event.clientY);
			if (nextElement === hoveredElement) {
				return;
			}

			setHoveredElement(nextElement);
			updateHighlight(nextElement);
		};

		const handleClick = (event: MouseEvent) => {
			if (isIgnoredNode(event.target)) {
				return;
			}

			const nextElement = getTargetElement(event.clientX, event.clientY);
			if (!nextElement) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			setSelectedElement(nextElement);
			setHoveredElement(null);
			updateHighlight(nextElement);
			setChooserPoint({ x: event.clientX, y: event.clientY });
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel();
			}
		};

		document.addEventListener("mousemove", handleMouseMove, true);
		document.addEventListener("click", handleClick, true);
		window.addEventListener("keydown", handleKeyDown, true);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove, true);
			document.removeEventListener("click", handleClick, true);
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [hoveredElement, onCancel, selectedElement, updateHighlight]);

	useEffect(() => {
		const trackedElement = selectedElement ?? hoveredElement;
		if (!trackedElement) {
			return;
		}

		const refreshRect = () => {
			updateHighlight(trackedElement);
		};

		window.addEventListener("scroll", refreshRect, true);
		window.addEventListener("resize", refreshRect, true);

		return () => {
			window.removeEventListener("scroll", refreshRect, true);
			window.removeEventListener("resize", refreshRect, true);
		};
	}, [hoveredElement, selectedElement, updateHighlight]);

	const chooserStyle = useMemo(() => {
		if (!chooserPoint) {
			return null;
		}

		const width = 220;
		const margin = 16;
		const left = Math.min(
			Math.max(chooserPoint.x, margin),
			window.innerWidth - width - margin,
		);
		const top = Math.min(
			Math.max(chooserPoint.y + 12, margin),
			window.innerHeight - 210,
		);

		return { left, top };
	}, [chooserPoint]);

	const handleChoose = useCallback(
		async (format: "text" | "clean_html" | "html" | "image") => {
			if (!selectedElement) {
				return;
			}

			if (format === "image") {
				// A picture of what is on screen, not a re-render of the DOM: the
				// latter silently drops every cross-origin image, which on a map is
				// the whole picture.
				setCaptureError(null);
				setIsCapturing(true);
				try {
					const captured = await captureElementRegion(selectedElement, {
						hide: getIgnoredContainers(),
					});
					const imageItem = createEmbeddedContextItem({
						kind: "selected_image",
						label: `${t("smartSelectImage")}: ${describeElement(selectedElement)}`,
						content: captured.dataUrl,
					});
					if (mode === "standalone") {
						setPendingItem(imageItem);
					} else {
						onSelectContext(imageItem);
					}
				} catch (error) {
					setCaptureError(
						error instanceof RegionCaptureError && error.needsActivation
							? t("smartSelectImageNeedsActivation")
							: t("smartSelectImageFailed"),
					);
				} finally {
					setIsCapturing(false);
				}
				return;
			}

			const descriptor = describeElement(selectedElement);

			let item: EmbeddedContextItem;
			if (format === "text") {
				item = createEmbeddedContextItem({
					kind: "smart_text",
					label: `${t("smartSelectText")}: ${describeElementText(selectedElement)}`,
					content: extractElementTextContent(selectedElement),
				});
			} else if (format === "clean_html") {
				item = createEmbeddedContextItem({
					kind: "smart_clean_html",
					label: `${t("smartSelectCleanHtml")}: ${descriptor}`,
					content: extractElementCleanHTML(selectedElement),
				});
			} else {
				item = createEmbeddedContextItem({
					kind: "smart_html",
					label: `${t("smartSelectHtml")}: ${descriptor}`,
					content: extractElementOuterHTML(selectedElement),
				});
			}

			if (mode === "standalone") {
				setPendingItem(item);
			} else {
				onSelectContext(item);
			}
		},
		[mode, onSelectContext, selectedElement, t],
	);

	const handleAction = useCallback(
		(action: SmartSelectAction) => {
			if (!pendingItem) return;
			onAction?.(pendingItem, action);
		},
		[onAction, pendingItem],
	);

	const handleCancelSelection = useCallback(() => {
		setSelectedElement(null);
		setPendingItem(null);
		setChooserPoint(null);
		updateHighlight(null);
	}, [updateHighlight]);

	return (
		<div
			id="memorall-smart-select-overlay"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 2147483646,
				pointerEvents: "none",
				fontFamily: "system-ui, -apple-system, sans-serif",
			}}
		>
			{highlightRect && (
				<div
					style={{
						position: "fixed",
						left: highlightRect.left,
						top: highlightRect.top,
						width: highlightRect.width,
						height: highlightRect.height,
						border: selectedElement
							? "2px solid rgba(59, 130, 246, 0.95)"
							: "2px solid rgba(16, 185, 129, 0.95)",
						backgroundColor: selectedElement
							? "rgba(59, 130, 246, 0.12)"
							: "rgba(16, 185, 129, 0.10)",
						boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.12)",
						borderRadius: "6px",
						transition: "all 120ms ease-out",
					}}
				/>
			)}

			{mode === "standalone" && (
				<div
					style={{
						position: "fixed",
						top: 16,
						left: "50%",
						transform: "translateX(-50%)",
						backgroundColor: "rgba(15, 23, 42, 0.96)",
						color: "#fff",
						padding: "10px 14px",
						borderRadius: "10px",
						boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
						fontSize: "13px",
						maxWidth: "min(420px, calc(100vw - 32px))",
						pointerEvents: "auto",
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 4 }}>
						{t("smartSelect")}
					</div>
					<div style={{ lineHeight: 1.4, color: "rgba(255,255,255,0.85)" }}>
						{t("smartSelectInstruction")}
					</div>
				</div>
			)}

			{mode === "standalone" && (
				<button
					type="button"
					onClick={onCancel}
					style={{
						position: "fixed",
						top: 18,
						right: 18,
						border: "none",
						borderRadius: "999px",
						backgroundColor: "rgba(220, 38, 38, 0.96)",
						color: "#fff",
						padding: "8px 14px",
						fontSize: "13px",
						fontWeight: 600,
						boxShadow: "0 10px 24px rgba(0, 0, 0, 0.28)",
						cursor: "pointer",
						pointerEvents: "auto",
					}}
				>
					{t("smartSelectCancel")}
				</button>
			)}

			{selectedElement && chooserStyle && (
				<div
					style={{
						position: "fixed",
						left: chooserStyle.left,
						top: chooserStyle.top,
						width: 220,
						backgroundColor: "#fff",
						color: "#111827",
						borderRadius: "12px",
						boxShadow: "0 18px 48px rgba(15, 23, 42, 0.32)",
						border: "1px solid rgba(148, 163, 184, 0.35)",
						padding: "10px",
						pointerEvents: "auto",
					}}
				>
					{!pendingItem ? (
						<>
							<div
								style={{
									fontSize: "12px",
									fontWeight: 700,
									color: "#475569",
									marginBottom: "8px",
								}}
							>
								{t("smartSelectChooseFormat")}
							</div>
							<div
								style={{
									fontSize: "12px",
									color: "#0f172a",
									backgroundColor: "#f8fafc",
									borderRadius: "8px",
									padding: "8px 10px",
									marginBottom: "8px",
									wordBreak: "break-word",
								}}
							>
								{describeElement(selectedElement)}
							</div>
							{captureError ? (
								<div
									style={{
										fontSize: "12px",
										lineHeight: "16px",
										color: "#b91c1c",
										backgroundColor: "#fef2f2",
										border: "1px solid rgb(248 113 113 / 0.4)",
										borderRadius: "8px",
										padding: "8px 10px",
										marginBottom: "8px",
									}}
								>
									{captureError}
								</div>
							) : null}
							<div style={{ display: "grid", gap: "8px" }}>
								<button
									type="button"
									onClick={() => handleChoose("text")}
									style={choiceButtonStyle}
								>
									{t("smartSelectText")}
								</button>
								<button
									type="button"
									onClick={() => handleChoose("clean_html")}
									style={choiceButtonStyle}
								>
									{t("smartSelectCleanHtml")}
								</button>
								<button
									type="button"
									disabled={isCapturing}
									onClick={() => void handleChoose("image")}
									style={choiceButtonStyle}
								>
									{isCapturing
										? t("smartSelectImageCapturing")
										: t("smartSelectImage")}
								</button>
								<button
									type="button"
									onClick={() => handleChoose("html")}
									style={choiceButtonStyle}
								>
									{t("smartSelectHtml")}
								</button>
								<button
									type="button"
									onClick={handleCancelSelection}
									style={{
										...choiceButtonStyle,
										backgroundColor: "#fee2e2",
										color: "#991b1b",
									}}
								>
									{t("smartSelectCancel")}
								</button>
							</div>
						</>
					) : (
						<>
							<div
								style={{
									fontSize: "12px",
									fontWeight: 700,
									color: "#475569",
									marginBottom: "8px",
								}}
							>
								{t("smartSelectChooseAction")}
							</div>
							<div
								style={{
									fontSize: "12px",
									color: "#0f172a",
									backgroundColor: "#f8fafc",
									borderRadius: "8px",
									padding: "8px 10px",
									marginBottom: "8px",
									wordBreak: "break-word",
								}}
							>
								{pendingItem.label}
							</div>
							<div style={{ display: "grid", gap: "8px" }}>
								<button
									type="button"
									onClick={() => handleAction("store-to-document")}
									style={choiceButtonStyle}
								>
									{t("smartSelectStoreToDocument")}
								</button>
								<button
									type="button"
									onClick={() => handleAction("open-chat")}
									style={{
										...choiceButtonStyle,
										backgroundColor: "#f0fdf4",
										color: "#15803d",
									}}
								>
									{t("smartSelectOpenChat")}
								</button>
								<button
									type="button"
									onClick={() => handleAction("open-full-chat")}
									style={{
										...choiceButtonStyle,
										backgroundColor: "#faf5ff",
										color: "#7c3aed",
									}}
								>
									{t("smartSelectOpenFullChat")}
								</button>
								<button
									type="button"
									onClick={handleCancelSelection}
									style={{
										...choiceButtonStyle,
										backgroundColor: "#fee2e2",
										color: "#991b1b",
									}}
								>
									{t("smartSelectCancel")}
								</button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
};

const choiceButtonStyle: React.CSSProperties = {
	border: "none",
	borderRadius: "8px",
	backgroundColor: "#eff6ff",
	color: "#1d4ed8",
	padding: "9px 12px",
	fontSize: "13px",
	fontWeight: 600,
	cursor: "pointer",
	textAlign: "left",
};

export function createSmartSelectOverlay(
	onSelectContext: (item: EmbeddedContextItem) => void,
	onCancel: () => void,
): () => void {
	return mountExclusiveOverlay({
		containerId: SMART_SELECT_CONTAINER_ID,
		onDisplaced: onCancel,
		render: (close) => (
			<SmartSelectOverlay
				mode="chat"
				onSelectContext={(item) => {
					onSelectContext(item);
					close();
				}}
				onCancel={() => {
					onCancel();
					close();
				}}
			/>
		),
	});
}

export function createStandaloneSmartSelectOverlay(
	onAction: (item: EmbeddedContextItem, action: SmartSelectAction) => void,
	onCancel: () => void,
): () => void {
	return mountExclusiveOverlay({
		containerId: SMART_SELECT_CONTAINER_ID,
		onDisplaced: onCancel,
		render: (close) => (
			<SmartSelectOverlay
				mode="standalone"
				onSelectContext={() => {}}
				onAction={(item, action) => {
					onAction(item, action);
					close();
				}}
				onCancel={() => {
					onCancel();
					close();
				}}
			/>
		),
	});
}
