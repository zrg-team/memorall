import React from "react";
import {
	CAPTURE_UI_ATTRIBUTE,
	type CaptureCrop,
	selectionRect,
} from "./capture-screen";

/** Below this, a drag is treated as a stray click, not an area. */
const MIN_AREA_PX = 8;

const captureUi = { [CAPTURE_UI_ATTRIBUTE]: "" };

const Hint: React.FC<{ text: string }> = ({ text }) => (
	<div
		{...captureUi}
		className="pointer-events-none absolute left-1/2 top-3 z-[10001] -translate-x-1/2 rounded-full bg-foreground/85 px-3 py-1 text-[11px] font-medium text-background shadow"
	>
		{text}
	</div>
);

/**
 * Picks what to capture on the desktop: a window (hover outlines it, a click
 * takes it) or an area (drag a rectangle). Escape, or a click on no window,
 * cancels. Everything drawn here is left out of the capture.
 */
export const MemonCaptureOverlay: React.FC<{
	mode: "window" | "area";
	desktopRef: React.RefObject<HTMLDivElement | null>;
	labels: { window: string; area: string };
	onWindow: (element: HTMLElement) => void;
	onArea: (crop: CaptureCrop) => void;
	onCancel: () => void;
}> = ({ mode, desktopRef, labels, onWindow, onArea, onCancel }) => {
	const [hovered, setHovered] = React.useState<CaptureCrop | null>(null);
	const [drag, setDrag] = React.useState<{
		from: { x: number; y: number };
		to: { x: number; y: number };
	} | null>(null);

	React.useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);

	// Window mode listens on the desktop itself, before the windows do, so a
	// click picks the window instead of pressing whatever is under it.
	React.useEffect(() => {
		const desktop = desktopRef.current;
		if (mode !== "window" || !desktop) return;
		const windowAt = (target: EventTarget | null) =>
			target instanceof Element
				? target.closest<HTMLElement>("[data-memon-window]")
				: null;
		const onMove = (event: MouseEvent) => {
			const element = windowAt(event.target);
			if (!element) {
				setHovered(null);
				return;
			}
			const box = desktop.getBoundingClientRect();
			const rect = element.getBoundingClientRect();
			setHovered({
				x: rect.left - box.left,
				y: rect.top - box.top,
				width: rect.width,
				height: rect.height,
			});
		};
		const onClick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			const element = windowAt(event.target);
			if (element) onWindow(element);
			else onCancel();
		};
		const stop = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		};
		desktop.addEventListener("mousemove", onMove, true);
		desktop.addEventListener("click", onClick, true);
		desktop.addEventListener("mousedown", stop, true);
		desktop.addEventListener("contextmenu", stop, true);
		return () => {
			desktop.removeEventListener("mousemove", onMove, true);
			desktop.removeEventListener("click", onClick, true);
			desktop.removeEventListener("mousedown", stop, true);
			desktop.removeEventListener("contextmenu", stop, true);
		};
	}, [mode, desktopRef, onWindow, onCancel]);

	const pointAt = (event: React.PointerEvent) => {
		const box = desktopRef.current?.getBoundingClientRect();
		return box
			? { x: event.clientX - box.left, y: event.clientY - box.top }
			: { x: 0, y: 0 };
	};
	const bounds = () => {
		const box = desktopRef.current?.getBoundingClientRect();
		return { width: box?.width ?? 0, height: box?.height ?? 0 };
	};

	if (mode === "window") {
		return (
			<>
				<Hint text={labels.window} />
				{hovered ? (
					<div
						{...captureUi}
						className="pointer-events-none absolute z-[10000] rounded-md ring-2 ring-cyan-500 ring-offset-1"
						style={{
							left: hovered.x,
							top: hovered.y,
							width: hovered.width,
							height: hovered.height,
						}}
					/>
				) : null}
			</>
		);
	}

	const area = drag ? selectionRect(drag.from, drag.to, bounds()) : null;
	return (
		<div
			{...captureUi}
			className="absolute inset-0 z-[10000] cursor-crosshair bg-black/10"
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				const point = pointAt(event);
				setDrag({ from: point, to: point });
			}}
			onPointerMove={(event) => {
				if (drag) setDrag({ ...drag, to: pointAt(event) });
			}}
			onPointerUp={(event) => {
				if (!drag) return;
				const crop = selectionRect(drag.from, pointAt(event), bounds());
				setDrag(null);
				if (crop.width >= MIN_AREA_PX && crop.height >= MIN_AREA_PX) {
					onArea(crop);
				} else {
					onCancel();
				}
			}}
		>
			<Hint text={labels.area} />
			{area ? (
				<div
					className="absolute border-2 border-cyan-500 bg-cyan-500/10"
					style={{
						left: area.x,
						top: area.y,
						width: area.width,
						height: area.height,
					}}
				/>
			) : null}
		</div>
	);
};
