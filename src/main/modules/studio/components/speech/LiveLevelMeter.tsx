import type React from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "./speech-studio-utils";

const BAR_COUNT = 12;

/**
 * A few bars that move with the voice while it streams.
 *
 * Bars are plain elements whose height is written straight from the animation
 * frame - no React state per frame, and no canvas, so it stays cheap next to a
 * running model and renders crisply at any zoom. With reduced motion the bars
 * sit still and a single dot says "live" instead.
 */
export const LiveLevelMeter: React.FC<{
	analyser: AnalyserNode | null;
	active: boolean;
	className?: string;
}> = ({ analyser, active, className }) => {
	const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
	const reducedMotion = prefersReducedMotion();

	useEffect(() => {
		if (!analyser || !active || reducedMotion) return;
		const data = new Uint8Array(analyser.frequencyBinCount);
		// Speech energy sits in the low bins; spreading bars over the whole
		// spectrum would leave the right half flat.
		const usableBins = Math.max(BAR_COUNT, Math.floor(data.length * 0.6));
		const binsPerBar = Math.floor(usableBins / BAR_COUNT);
		let frame = 0;
		const draw = () => {
			analyser.getByteFrequencyData(data);
			for (let bar = 0; bar < BAR_COUNT; bar++) {
				let sum = 0;
				for (let bin = 0; bin < binsPerBar; bin++) {
					sum += data[bar * binsPerBar + bin] ?? 0;
				}
				const level = sum / binsPerBar / 255;
				const element = barsRef.current[bar];
				if (element) {
					element.style.transform = `scaleY(${Math.max(0.12, level)})`;
				}
			}
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(frame);
			for (const element of barsRef.current) {
				if (element) element.style.transform = "scaleY(0.12)";
			}
		};
	}, [analyser, active, reducedMotion]);

	if (reducedMotion) {
		return (
			<span
				className={cn("flex items-center gap-1 text-[11px]", className)}
				aria-hidden
				data-live-level="static"
			>
				<span
					className={cn(
						"h-2 w-2 rounded-full",
						active ? "bg-primary" : "bg-muted-foreground/40",
					)}
				/>
			</span>
		);
	}

	return (
		<span
			className={cn("flex h-5 items-center gap-[2px]", className)}
			aria-hidden
			data-live-level="bars"
		>
			{Array.from({ length: BAR_COUNT }, (_, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative bars.
					key={index}
					ref={(element) => {
						barsRef.current[index] = element;
					}}
					className="h-full w-[3px] origin-center rounded-full bg-primary/80 transition-transform duration-75"
					style={{ transform: "scaleY(0.12)" }}
				/>
			))}
		</span>
	);
};
