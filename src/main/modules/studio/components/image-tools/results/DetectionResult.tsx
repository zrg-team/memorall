import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ImageToolDetection } from "@/types/openai-media";
import { StoredImage } from "../../shared/StoredImage";
import {
	countDetectionsByLabel,
	detectionHue,
	formatScore,
	type Size,
	scaleDetectionBox,
} from "../detection-geometry";

const colorFor = (label: string, alpha = 1) =>
	`hsl(${detectionHue(label)} 85% 50% / ${alpha})`;

interface DetectionResultProps {
	image: { path: string; mimeType: string; width?: number; height?: number };
	detections: ImageToolDetection[];
	alt: string;
	threshold?: number;
}

/**
 * The input image with its detections drawn over it, plus a list to scan.
 *
 * Boxes are laid out in displayed pixels rather than percentages so label
 * chips can decide whether they fit above a box; the displayed size is
 * re-measured whenever the card resizes (panel drag, window resize).
 */
export const DetectionResult: React.FC<DetectionResultProps> = ({
	image,
	detections,
	alt,
	threshold,
}) => {
	const { t } = useTranslation("studioTools");
	const frame = useRef<HTMLDivElement>(null);
	const [natural, setNatural] = useState<Size | null>(
		image.width && image.height
			? { width: image.width, height: image.height }
			: null,
	);
	const [displayed, setDisplayed] = useState<Size>({ width: 0, height: 0 });
	const [highlight, setHighlight] = useState<number | null>(null);
	const counts = useMemo(
		() => countDetectionsByLabel(detections),
		[detections],
	);

	const measure = () => {
		const element = frame.current;
		if (!element) return;
		const width = element.clientWidth;
		const height = element.clientHeight;
		setDisplayed((current) =>
			current.width === width && current.height === height
				? current
				: { width, height },
		);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: measure only reads the ref
	useEffect(() => {
		const element = frame.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="flex flex-col gap-2" data-detection-result>
			<div
				ref={frame}
				className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-border/60 bg-muted/30"
			>
				<StoredImage
					path={image.path}
					mimeType={image.mimeType}
					alt={alt}
					className="block max-h-[28rem] w-auto max-w-full"
					placeholderClassName="h-56 w-72 max-w-full"
					onLoad={(event) => {
						const element = event.currentTarget;
						if (element.naturalWidth && element.naturalHeight) {
							setNatural({
								width: element.naturalWidth,
								height: element.naturalHeight,
							});
						}
						measure();
					}}
				/>
				{natural
					? detections.map((detection, index) => {
							const rect = scaleDetectionBox(detection.box, natural, displayed);
							const dimmed = highlight !== null && highlight !== index;
							const color = colorFor(detection.label);
							// Chips sit above the box unless it touches the top edge.
							const chipInside = rect.top < 18;
							return (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: detections have no ids
									key={index}
									className={cn(
										"pointer-events-none absolute rounded-sm border-2 transition-opacity",
										dimmed ? "opacity-25" : "opacity-100",
										highlight === index && "z-10",
									)}
									style={{
										left: rect.left,
										top: rect.top,
										width: rect.width,
										height: rect.height,
										borderColor: color,
										backgroundColor:
											highlight === index
												? colorFor(detection.label, 0.15)
												: undefined,
									}}
									data-detection-box={detection.label}
								>
									<span
										className={cn(
											"absolute left-[-2px] whitespace-nowrap rounded-sm px-1 py-px text-[10px] font-medium leading-tight text-white",
											chipInside ? "top-0" : "-top-[18px]",
										)}
										style={{ backgroundColor: color }}
									>
										{detection.label} {formatScore(detection.score)}
									</span>
								</div>
							);
						})
					: null}
			</div>

			{detections.length === 0 ? (
				<p className="text-xs text-muted-foreground" data-detections-empty>
					{t("result.noDetections", {
						defaultValue: "No objects found above the confidence threshold.",
					})}
				</p>
			) : (
				<>
					<div
						className="flex flex-wrap items-center gap-1.5"
						data-detection-counts
					>
						{counts.map(({ label, count }) => (
							<span
								key={label}
								className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]"
							>
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: colorFor(label) }}
									aria-hidden
								/>
								{label}
								<span className="tabular-nums text-muted-foreground">
									×{count}
								</span>
							</span>
						))}
						{typeof threshold === "number" ? (
							<span className="ml-auto text-[11px] text-muted-foreground">
								{t("result.threshold", {
									value: formatScore(threshold),
									defaultValue: `Threshold ${formatScore(threshold)}`,
								})}
							</span>
						) : null}
					</div>
					<ul className="max-h-48 divide-y divide-border/50 overflow-y-auto rounded-md border border-border/60">
						{detections.map((detection, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: detections have no ids
							<li key={index}>
								<button
									type="button"
									className={cn(
										"flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none",
										highlight === index ? "bg-accent" : "hover:bg-accent/60",
									)}
									onMouseEnter={() => setHighlight(index)}
									onMouseLeave={() => setHighlight(null)}
									onFocus={() => setHighlight(index)}
									onBlur={() => setHighlight(null)}
									aria-label={`${detection.label} ${formatScore(detection.score)}`}
									data-detection-row={index}
								>
									<span
										className="h-2.5 w-2.5 shrink-0 rounded-sm"
										style={{ backgroundColor: colorFor(detection.label) }}
										aria-hidden
									/>
									<span className="min-w-0 flex-1 truncate">
										{detection.label}
									</span>
									<span className="tabular-nums text-muted-foreground">
										{formatScore(detection.score)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
};
