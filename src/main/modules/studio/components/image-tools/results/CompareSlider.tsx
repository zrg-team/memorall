import { ChevronsLeftRight } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StoredImage } from "../../shared/StoredImage";
import {
	positionFromPointer,
	stepComparePosition,
} from "../detection-geometry";

interface StoredRef {
	path: string;
	mimeType: string;
}

/** Transparent pixels read as "cut out" only against a checkerboard. */
export const CHECKERBOARD_STYLE: React.CSSProperties = {
	backgroundColor: "#ffffff",
	backgroundImage:
		"linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)",
	backgroundSize: "16px 16px",
	backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
};

/**
 * Before/after comparison: the original on the left of the divider, the
 * result on the right.
 *
 * Both images are stacked at the same size and the original is clipped, so
 * edges line up pixel for pixel wherever the divider sits.
 */
export const CompareSlider: React.FC<{
	before: StoredRef;
	after: StoredRef;
	alt: string;
}> = ({ before, after, alt }) => {
	const { t } = useTranslation("studioTools");
	const [position, setPosition] = useState(50);
	const container = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);

	const moveTo = (clientX: number) => {
		const rect = container.current?.getBoundingClientRect();
		if (rect) setPosition(positionFromPointer(clientX, rect));
	};

	return (
		<div
			ref={container}
			className="relative mx-auto w-fit max-w-full touch-none select-none overflow-hidden rounded-lg border border-border/60"
			style={CHECKERBOARD_STYLE}
			onPointerDown={(event) => {
				dragging.current = true;
				event.currentTarget.setPointerCapture?.(event.pointerId);
				moveTo(event.clientX);
			}}
			onPointerMove={(event) => {
				if (dragging.current) moveTo(event.clientX);
			}}
			onPointerUp={() => {
				dragging.current = false;
			}}
			onPointerCancel={() => {
				dragging.current = false;
			}}
			data-compare-slider
		>
			<StoredImage
				path={after.path}
				mimeType={after.mimeType}
				alt={t("result.cutoutAlt", {
					name: alt,
					defaultValue: `${alt} without background`,
				})}
				className="pointer-events-none block max-h-[28rem] w-auto max-w-full"
				placeholderClassName="h-56 w-72 max-w-full"
				draggable={false}
			/>
			<div
				className="pointer-events-none absolute inset-0"
				style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
			>
				<StoredImage
					path={before.path}
					mimeType={before.mimeType}
					alt={alt}
					className="h-full w-full"
					placeholderClassName="h-full w-full"
					draggable={false}
				/>
			</div>
			<span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
				{t("result.before", { defaultValue: "Before" })}
			</span>
			<span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
				{t("result.after", { defaultValue: "After" })}
			</span>
			<div
				className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
				style={{ left: `${position}%` }}
			>
				<div
					role="slider"
					tabIndex={0}
					aria-label={t("result.compare", {
						defaultValue: "Compare before and after",
					})}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(position)}
					aria-orientation="horizontal"
					className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-black/10 bg-white text-zinc-700 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onKeyDown={(event) => {
						const next = stepComparePosition(
							position,
							event.key,
							event.shiftKey,
						);
						if (next === null) return;
						event.preventDefault();
						setPosition(next);
					}}
					data-compare-handle
				>
					<ChevronsLeftRight size={16} />
				</div>
			</div>
		</div>
	);
};
