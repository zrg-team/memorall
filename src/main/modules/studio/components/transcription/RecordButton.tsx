import { Loader2, Mic, MicOff, Square } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { RecorderState } from "../../hooks/use-audio-recorder";

interface RecordButtonProps {
	state: RecorderState;
	/** Input level 0-1, drives the ring around the button. */
	level: number;
	size: "large" | "compact";
	disabled?: boolean;
	onStart: () => void;
	onStop: () => void;
}

/**
 * One button for the whole take: press to record, press again to stop and
 * transcribe. It is a real `<button>`, so Space and Enter work without extra
 * handlers. The ring scales with the input level so the user sees they are
 * heard; under reduced motion it stays still and only its opacity follows
 * the level.
 */
export const RecordButton: React.FC<RecordButtonProps> = ({
	state,
	level,
	size,
	disabled,
	onStart,
	onStop,
}) => {
	const { t } = useTranslation("studioTranscription");
	const recording = state === "recording";
	const requesting = state === "requesting";
	const blocked = state === "denied" || state === "unsupported";
	const large = size === "large";
	const label = recording
		? t("record.stop", { defaultValue: "Stop and transcribe" })
		: t("record.start", { defaultValue: "Start recording" });
	const clamped = Math.max(0, Math.min(1, level));

	return (
		<div
			className={cn(
				"relative flex shrink-0 items-center justify-center",
				large ? "h-28 w-28" : "h-11 w-11",
			)}
		>
			{recording ? (
				<span
					aria-hidden
					data-record-level={clamped.toFixed(2)}
					className="pointer-events-none absolute inset-0 rounded-full bg-destructive/25 transition-[scale,opacity] duration-75 [scale:calc(0.8+var(--level)*0.45)] motion-reduce:[scale:1] motion-reduce:transition-none"
					style={
						{
							"--level": clamped,
							opacity: 0.35 + clamped * 0.65,
						} as React.CSSProperties
					}
				/>
			) : null}
			<button
				type="button"
				onClick={recording ? onStop : onStart}
				disabled={disabled || requesting || state === "unsupported"}
				aria-label={label}
				aria-pressed={recording}
				title={label}
				data-record-button={state}
				className={cn(
					"relative flex items-center justify-center rounded-full shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
					large ? "h-20 w-20" : "h-9 w-9",
					recording
						? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
						: blocked
							? "bg-muted text-muted-foreground"
							: "bg-primary text-primary-foreground hover:bg-primary/90",
				)}
			>
				{requesting ? (
					<Loader2 size={large ? 28 : 16} className="animate-spin" />
				) : recording ? (
					<Square size={large ? 24 : 14} fill="currentColor" />
				) : blocked ? (
					<MicOff size={large ? 28 : 16} />
				) : (
					<Mic size={large ? 30 : 16} />
				)}
			</button>
		</div>
	);
};
