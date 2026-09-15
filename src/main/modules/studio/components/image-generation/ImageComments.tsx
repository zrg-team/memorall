import { Crop, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { ImageComment, ImageRegion } from "@/types/studio";
import { v4 } from "@/utils/uuid";
import { regionBetween } from "./image-feedback";

type Point = { x: number; y: number };

const regionStyle = (region: ImageRegion): React.CSSProperties => ({
	left: `${region.x * 100}%`,
	top: `${region.y * 100}%`,
	width: `${region.width * 100}%`,
	height: `${region.height * 100}%`,
});

/**
 * The box the `<img>` next to `layer` occupies in their shared parent. The
 * layer's own element is used to find it: a parent's ref is not attached yet
 * when a child's layout effect runs.
 */
function useImageBox(layer: React.RefObject<HTMLElement | null>) {
	const [box, setBox] = useState<React.CSSProperties | null>(null);
	useLayoutEffect(() => {
		const element = layer.current?.parentElement;
		if (!element) return;
		const measure = () => {
			const image = element.querySelector("img");
			if (!image || !image.offsetWidth) {
				setBox(null);
				return;
			}
			setBox({
				left: image.offsetLeft,
				top: image.offsetTop,
				width: image.offsetWidth,
				height: image.offsetHeight,
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const mutations = new MutationObserver(() => {
			measure();
			const image = element.querySelector("img");
			if (image) observer.observe(image);
		});
		mutations.observe(element, { childList: true, subtree: true });
		element.addEventListener("load", measure, true);
		return () => {
			observer.disconnect();
			mutations.disconnect();
			element.removeEventListener("load", measure, true);
		};
	}, [layer]);
	return box;
}

interface ImageCommentLayerProps {
	comments: readonly ImageComment[];
	/** Drawing regions is on. */
	active: boolean;
	pending: ImageRegion | null;
	onPendingChange: (region: ImageRegion | null) => void;
	highlightedId?: string | null;
}

/**
 * Numbered region markers over an image, and dragging to select a new one.
 * Render it next to the `<img>`, inside a positioned parent.
 */
export const ImageCommentLayer: React.FC<ImageCommentLayerProps> = ({
	comments,
	active,
	pending,
	onPendingChange,
	highlightedId,
}) => {
	const { t } = useTranslation("studioImage");
	const self = useRef<HTMLDivElement>(null);
	const box = useImageBox(self);
	const start = useRef<Point | null>(null);
	const [draft, setDraft] = useState<ImageRegion | null>(null);

	const pointOf = (event: React.PointerEvent<HTMLDivElement>): Point => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height,
		};
	};

	return (
		<div
			ref={self}
			className={cn(
				"absolute select-none",
				active ? "cursor-crosshair touch-none" : "pointer-events-none",
			)}
			style={box ?? { display: "none" }}
			data-image-comment-layer={active ? "active" : "idle"}
			aria-label={
				active
					? t("comments.dragHint", {
							defaultValue: "Drag on the image to select an area",
						})
					: undefined
			}
			onPointerDown={(event) => {
				if (!active || event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				start.current = pointOf(event);
				setDraft(null);
			}}
			onPointerMove={(event) => {
				if (!start.current) return;
				setDraft(regionBetween(start.current, pointOf(event)));
			}}
			onPointerUp={(event) => {
				if (!start.current) return;
				const region = regionBetween(start.current, pointOf(event));
				start.current = null;
				setDraft(null);
				// A click without a drag clears the selection: the note is then
				// about the whole image.
				onPendingChange(region);
			}}
			onPointerCancel={() => {
				start.current = null;
				setDraft(null);
			}}
		>
			{comments.map((comment, index) =>
				comment.region ? (
					<div
						key={comment.id}
						className={cn(
							"absolute rounded-sm border-2 border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-colors",
							highlightedId === comment.id && "bg-amber-400/20",
						)}
						style={regionStyle(comment.region)}
						data-image-comment-marker={index + 1}
					>
						<span className="absolute -left-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-br-md rounded-tl-sm bg-amber-400 px-1 text-[11px] font-semibold text-black">
							{index + 1}
						</span>
					</div>
				) : null,
			)}
			{draft || pending ? (
				<div
					className="absolute rounded-sm border-2 border-dashed border-white bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
					style={regionStyle((draft ?? pending) as ImageRegion)}
					data-image-comment-pending
				/>
			) : null}
		</div>
	);
};

interface ImageCommentPanelProps {
	comments: readonly ImageComment[];
	onCommentsChange: (comments: ImageComment[]) => void;
	pending: ImageRegion | null;
	onClearPending: () => void;
	onHighlight: (id: string | null) => void;
	onGenerate: () => void;
	/** An image is being generated; a new one cannot start yet. */
	busy: boolean;
	className?: string;
}

/** The notes on one image, a box to add one, and the button that uses them. */
export const ImageCommentPanel: React.FC<ImageCommentPanelProps> = ({
	comments,
	onCommentsChange,
	pending,
	onClearPending,
	onHighlight,
	onGenerate,
	busy,
	className,
}) => {
	const { t } = useTranslation("studioImage");
	const [text, setText] = useState("");
	const input = useRef<HTMLTextAreaElement>(null);

	// Selecting an area is the first half of a note; the second is typing it.
	useEffect(() => {
		if (pending) input.current?.focus();
	}, [pending]);

	const add = () => {
		const value = text.trim();
		if (!value) return;
		onCommentsChange([
			...comments,
			{
				id: v4(),
				text: value,
				region: pending ?? undefined,
				createdAt: Date.now(),
			},
		]);
		setText("");
		onClearPending();
	};

	return (
		<div
			className={cn("flex min-h-0 flex-col gap-2", className)}
			data-image-comment-panel
		>
			<div className="flex items-center gap-1.5 text-xs font-medium">
				<MessageSquare size={14} className="text-muted-foreground" />
				{t("comments.title", { defaultValue: "Comments" })}
				{comments.length > 0 ? (
					<span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
						{comments.length}
					</span>
				) : null}
			</div>

			{comments.length === 0 ? (
				<p className="text-xs leading-5 text-muted-foreground">
					{t("comments.empty", {
						defaultValue:
							"Say what to change. Drag on the image to point at an area, or write about the whole image.",
					})}
				</p>
			) : (
				<ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
					{comments.map((comment, index) => (
						<li
							key={comment.id}
							className="group flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs"
							onMouseEnter={() => onHighlight(comment.id)}
							onMouseLeave={() => onHighlight(null)}
							data-image-comment={comment.region ? "region" : "image"}
						>
							<span
								className={cn(
									"mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold",
									comment.region
										? "bg-amber-400 text-black"
										: "bg-muted text-muted-foreground",
								)}
								title={
									comment.region
										? t("comments.area", { defaultValue: "Selected area" })
										: t("comments.wholeImage", { defaultValue: "Whole image" })
								}
							>
								{index + 1}
							</span>
							<span className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-5">
								{comment.text}
							</span>
							<button
								type="button"
								className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={() =>
									onCommentsChange(
										comments.filter((other) => other.id !== comment.id),
									)
								}
								aria-label={t("comments.remove", {
									defaultValue: "Remove comment",
								})}
								data-image-comment-remove
							>
								<X size={12} />
							</button>
						</li>
					))}
				</ol>
			)}

			<form
				className="space-y-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				{pending ? (
					<div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-300">
						<Crop size={12} />
						{t("comments.areaSelected", {
							defaultValue: "Area selected",
						})}
						<button
							type="button"
							className="underline-offset-2 hover:underline"
							onClick={onClearPending}
							data-image-comment-clear-area
						>
							{t("comments.clearArea", { defaultValue: "Clear" })}
						</button>
					</div>
				) : null}
				<textarea
					ref={input}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							add();
						}
					}}
					rows={2}
					placeholder={
						pending
							? t("comments.placeholderArea", {
									defaultValue: "What should change in this area?",
								})
							: t("comments.placeholder", {
									defaultValue: "What should change?",
								})
					}
					className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
					data-image-comment-input
				/>
				<div className="flex items-center justify-between gap-2">
					<span className="text-[11px] text-muted-foreground">
						{t("comments.dragHint", {
							defaultValue: "Drag on the image to select an area",
						})}
					</span>
					<Button
						type="submit"
						size="sm"
						variant="secondary"
						className="h-7 px-2.5 text-xs"
						disabled={!text.trim()}
						data-image-comment-add
					>
						{t("comments.add", { defaultValue: "Add" })}
					</Button>
				</div>
			</form>

			<Button
				type="button"
				size="sm"
				className="h-8 gap-1.5 text-xs"
				disabled={comments.length === 0 || busy}
				onClick={onGenerate}
				data-image-generate-next
			>
				{busy ? (
					<Loader2 size={14} className="animate-spin" />
				) : (
					<Sparkles size={14} />
				)}
				{comments.length > 0
					? t("comments.generateWith", {
							total: comments.length,
							defaultValue: `Generate next image (${comments.length})`,
						})
					: t("comments.generate", { defaultValue: "Generate next image" })}
			</Button>
			{busy ? (
				<p className="text-[11px] text-muted-foreground">
					{t("comments.busy", {
						defaultValue: "Wait for the current image to finish.",
					})}
				</p>
			) : null}
		</div>
	);
};
