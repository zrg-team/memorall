/**
 * Canvas select — drag a rectangle anywhere and attach what is inside it.
 *
 * "Canvas" means the page as a canvas, not an `HTMLCanvasElement`: unlike smart
 * select this snaps to nothing, so whatever is visible between the two corners
 * is what gets captured.
 *
 * The page is photographed once when the overlay opens and every drag is cut
 * from that still. Cropping a frozen frame is what the user was looking at when
 * they dragged, costs one capture per session rather than one per attempt, and
 * cannot trip `captureVisibleTab`'s rate limit.
 */

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	captureViewport,
	cropCapture,
	DEFAULT_MAX_CAPTURE_EDGE,
	RegionCaptureError,
} from "../utils/capture-region";
import {
	clampRectToViewport,
	type DragPoint,
	type DragRect,
	formatRectSize,
	isBelowMinimumSelection,
	normalizeDragRect,
} from "../utils/drag-rect";
import {
	CANVAS_SELECT_CONTAINER_ID,
	getMemorallOverlayContainers,
	mountExclusiveOverlay,
} from "./overlay-registry";
import { createEmbeddedContextItem } from "@/embedded/context-items";
import type { EmbeddedContextItem } from "@/embedded/types";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { logWarn } from "@/utils/logger";

interface CanvasSelectOverlayProps {
	onSelectContext: (item: EmbeddedContextItem) => void;
	onCancel: () => void;
}

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

const OVERLAY_Z_INDEX = 2147483647;

/** Keeps the readout from hanging off the edge it is anchored to. */
const READOUT_MARGIN = 8;
const READOUT_WIDTH = 96;
const READOUT_HEIGHT = 28;

export const CanvasSelectOverlay: React.FC<CanvasSelectOverlayProps> = ({
	onSelectContext,
	onCancel,
}) => {
	const t = useEmbeddedTranslation("canvasSelect");
	const [capture, setCapture] = useState<string | null>(null);
	const [errorCause, setErrorCause] = useState<
		"needs-activation" | "failed" | null
	>(null);
	const [start, setStart] = useState<DragPoint | null>(null);
	const [end, setEnd] = useState<DragPoint | null>(null);
	const [isCropping, setIsCropping] = useState(false);
	const cancelRef = useRef(onCancel);
	cancelRef.current = onCancel;

	// Photograph the page with our own UI out of the way.
	//
	// captureVisibleTab returns the last painted frame, so an overlay that is
	// already on screen ends up in its own picture — which is why this renders
	// nothing until the still is in hand, and why the dock and chat modal are
	// hidden for the whole session rather than just for the capture.
	useEffect(() => {
		let cancelled = false;
		// Everything except this overlay: the list includes our own container, and
		// unlike the element capture — which restores in a finally block moments
		// later — these stay hidden for the whole session, so hiding ourselves
		// would mean nothing ever appears.
		const hidden = getMemorallOverlayContainers()
			.filter((node) => node.id !== CANVAS_SELECT_CONTAINER_ID)
			.map((node) => {
				const previous = node.style.visibility;
				node.style.visibility = "hidden";
				return { node, previous };
			});

		const run = async () => {
			try {
				await nextFrame();
				await nextFrame();
				const dataUrl = await captureViewport();
				if (!cancelled) setCapture(dataUrl);
			} catch (err) {
				logWarn("[CANVAS_SELECT] Could not capture the page:", err);
				if (cancelled) return;
				// Blinking out with no explanation is what made the permission
				// failure look like the feature was broken.
				setErrorCause(
					err instanceof RegionCaptureError && err.needsActivation
						? "needs-activation"
						: "failed",
				);
			}
		};

		void run();

		return () => {
			cancelled = true;
			for (const { node, previous } of hidden) {
				node.style.visibility = previous;
			}
		};
		// Deliberately empty: this must happen once per overlay. `t` changes
		// identity when the stored language loads, and re-running would take a
		// second picture — of the still this one is already showing.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ESC on the capture phase: pages do swallow keydown.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				cancelRef.current();
			}
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, []);

	// The still stops matching the page the moment the viewport changes.
	useEffect(() => {
		const onResize = () => cancelRef.current();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	// The page scrolls under the frozen still — invisible, but real.
	useEffect(() => {
		const block = (event: Event) => event.preventDefault();
		document.addEventListener("wheel", block, { passive: false });
		document.addEventListener("touchmove", block, { passive: false });
		return () => {
			document.removeEventListener("wheel", block);
			document.removeEventListener("touchmove", block);
		};
	}, []);

	const rect: DragRect | null =
		start && end
			? clampRectToViewport(
					normalizeDragRect(start, end),
					window.innerWidth,
					window.innerHeight,
				)
			: null;
	const tooSmall = rect ? isBelowMinimumSelection(rect) : true;

	const handlePointerDown = useCallback((event: React.PointerEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		// Capture the pointer so a drag that leaves the window still ends.
		event.currentTarget.setPointerCapture?.(event.pointerId);
		const point = { x: event.clientX, y: event.clientY };
		setStart(point);
		setEnd(point);
	}, []);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent) => {
			if (!start) return;
			setEnd({ x: event.clientX, y: event.clientY });
		},
		[start],
	);

	const handlePointerUp = useCallback(async () => {
		if (!start || !rect || !capture) {
			setStart(null);
			setEnd(null);
			return;
		}

		if (isBelowMinimumSelection(rect)) {
			// A stray click should not attach a 1x1 image; let the user try again.
			setStart(null);
			setEnd(null);
			return;
		}

		setIsCropping(true);
		try {
			// One drag here can select the whole screen, which smart select never
			// could; cap it so the attachment stays a sane size.
			const captured = await cropCapture(capture, rect, {
				maxEdge: DEFAULT_MAX_CAPTURE_EDGE,
			});
			onSelectContext(
				createEmbeddedContextItem({
					kind: "selected_image",
					// The CSS-pixel size, which is the number the user watched while
					// dragging — the crop is twice that on a 2x display.
					label: t("attachmentLabel", {
						width: Math.round(rect.width),
						height: Math.round(rect.height),
					}),
					content: captured.dataUrl,
				}),
			);
		} catch (err) {
			logWarn("[CANVAS_SELECT] Could not crop the selection:", err);
			setErrorCause(
				err instanceof RegionCaptureError && err.needsActivation
					? "needs-activation"
					: "failed",
			);
		} finally {
			setIsCropping(false);
			setStart(null);
			setEnd(null);
		}
	}, [start, rect, capture, onSelectContext, t]);

	if (errorCause) {
		return (
			<div
				data-testid="canvas-select-error"
				style={{
					position: "fixed",
					inset: 0,
					zIndex: OVERLAY_Z_INDEX,
					background: "rgba(0, 0, 0, 0.55)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontFamily: "system-ui, -apple-system, sans-serif",
				}}
			>
				<div
					style={{
						maxWidth: "360px",
						padding: "20px",
						borderRadius: "12px",
						background: "#fff",
						color: "#111",
						textAlign: "center",
						boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3)",
					}}
				>
					<div style={{ fontSize: "14px", lineHeight: 1.5 }}>
						{errorCause === "needs-activation"
							? t("needsActivation")
							: t("failed")}
					</div>
					<button
						type="button"
						onClick={onCancel}
						style={{
							marginTop: "16px",
							padding: "8px 16px",
							border: "none",
							borderRadius: "8px",
							background: "#3b82f6",
							color: "#fff",
							fontSize: "13px",
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						{t("cancel")}
					</button>
				</div>
			</div>
		);
	}

	// Nothing is rendered until the still is in hand, so the capture is of the
	// page rather than of this overlay.
	if (!capture) {
		return null;
	}

	const readoutLeft = rect
		? Math.min(
				rect.left + rect.width + READOUT_MARGIN,
				window.innerWidth - READOUT_WIDTH,
			)
		: 0;
	const readoutTop = rect
		? Math.min(
				rect.top + rect.height + READOUT_MARGIN,
				window.innerHeight - READOUT_HEIGHT,
			)
		: 0;

	return (
		<div
			data-testid="canvas-select-surface"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: OVERLAY_Z_INDEX,
				cursor: isCropping ? "wait" : "crosshair",
				userSelect: "none",
				fontFamily: "system-ui, -apple-system, sans-serif",
			}}
		>
			<img
				src={capture}
				alt={t("capturedPageAlt")}
				draggable={false}
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					width: "100vw",
					height: "100vh",
					pointerEvents: "none",
				}}
			/>

			{/* One div dims everything outside the selection, so there is no second
			    coordinate space to keep in step with the page. */}
			<div
				data-testid="canvas-select-region"
				style={{
					position: "fixed",
					left: `${rect?.left ?? 0}px`,
					top: `${rect?.top ?? 0}px`,
					width: `${rect?.width ?? 0}px`,
					height: `${rect?.height ?? 0}px`,
					boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${rect ? 0.45 : 0.35})`,
					border: rect ? "2px solid #3b82f6" : "none",
					pointerEvents: "none",
				}}
			/>

			{rect && (rect.width > 0 || rect.height > 0) ? (
				<div
					data-testid="canvas-select-size"
					style={{
						position: "fixed",
						left: `${readoutLeft}px`,
						top: `${readoutTop}px`,
						padding: "4px 8px",
						borderRadius: "6px",
						background: tooSmall ? "#b45309" : "rgba(17, 24, 39, 0.9)",
						color: "#fff",
						fontSize: "12px",
						fontWeight: 600,
						whiteSpace: "nowrap",
						pointerEvents: "none",
					}}
				>
					{formatRectSize(rect)}
					{tooSmall ? ` · ${t("tooSmall")}` : ""}
				</div>
			) : null}

			<div
				style={{
					position: "fixed",
					top: "24px",
					left: "50%",
					transform: "translateX(-50%)",
					padding: "10px 16px",
					borderRadius: "9999px",
					background: "rgba(17, 24, 39, 0.9)",
					color: "#fff",
					fontSize: "13px",
					pointerEvents: "none",
				}}
			>
				{t("instruction")}
			</div>
		</div>
	);
};

/**
 * Mount canvas select as the only page overlay.
 *
 * `onCancel` also stands for "something else took over", so an owner that
 * mirrors this overlay's liveness in its own state stays in step.
 */
export function createCanvasSelectOverlay(
	onSelectContext: (item: EmbeddedContextItem) => void,
	onCancel: () => void,
): () => void {
	return mountExclusiveOverlay({
		containerId: CANVAS_SELECT_CONTAINER_ID,
		onDisplaced: onCancel,
		render: (close) => (
			<CanvasSelectOverlay
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
