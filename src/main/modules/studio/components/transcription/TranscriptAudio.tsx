import { Loader2, Pause, Play } from "lucide-react";
import type React from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { useMediaUrl } from "../../hooks/use-media-url";
import { formatClock } from "./transcript-format";

export interface TranscriptAudioHandle {
	/** Jump to `seconds` and start playing, so a timestamp click is one action. */
	playFrom: (seconds: number) => void;
}

interface TranscriptAudioProps {
	path: string;
	mimeType: string;
	durationMs?: number;
	/** Reports the playhead so the transcript can highlight the spoken segment. */
	onPosition?: (seconds: number, playing: boolean) => void;
	ref?: React.Ref<TranscriptAudioHandle>;
	className?: string;
}

/**
 * The input clip of a transcript card.
 *
 * `AudioClipPlayer` keeps its element private; the transcript needs to seek it
 * from a segment and follow its playhead, so this is a small player that
 * exposes both. It joins the same "one clip at a time" rule via
 * `data-studio-clip`.
 */
export const TranscriptAudio: React.FC<TranscriptAudioProps> = ({
	path,
	mimeType,
	durationMs,
	onPosition,
	ref,
	className,
}) => {
	const { t } = useTranslation("studioTranscription");
	const { url, error } = useMediaUrl(path, mimeType);
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [position, setPosition] = useState(0);
	const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
	// A pending seek from a timestamp clicked before the object URL resolved.
	const pendingSeekRef = useRef<number | null>(null);
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;

	useImperativeHandle(
		ref,
		() => ({
			playFrom: (seconds) => {
				const audio = audioRef.current;
				if (!audio) {
					pendingSeekRef.current = seconds;
					return;
				}
				audio.currentTime = seconds;
				setPosition(seconds);
				onPositionRef.current?.(seconds, !audio.paused);
				void audio.play()?.catch(() => undefined);
			},
		}),
		[],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the <audio> element only mounts once the url resolves, so listeners attach per url.
	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const report = () => {
			setPosition(audio.currentTime);
			onPositionRef.current?.(audio.currentTime, !audio.paused);
		};
		const onMeta = () => {
			// MediaRecorder webm reports Infinity; keep the recorded length then.
			if (Number.isFinite(audio.duration) && audio.duration > 0) {
				setDuration(audio.duration);
			}
			if (pendingSeekRef.current !== null) {
				audio.currentTime = pendingSeekRef.current;
				pendingSeekRef.current = null;
				void audio.play()?.catch(() => undefined);
			}
		};
		const onPlay = () => {
			setPlaying(true);
			document.querySelectorAll("audio[data-studio-clip]").forEach((other) => {
				if (other !== audio) (other as HTMLAudioElement).pause();
			});
			report();
		};
		const onPause = () => {
			setPlaying(false);
			report();
		};
		audio.addEventListener("timeupdate", report);
		audio.addEventListener("seeked", report);
		audio.addEventListener("loadedmetadata", onMeta);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("ended", onPause);
		return () => {
			audio.removeEventListener("timeupdate", report);
			audio.removeEventListener("seeked", report);
			audio.removeEventListener("loadedmetadata", onMeta);
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
			audio.removeEventListener("ended", onPause);
		};
	}, [url]);

	const toggle = () => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) void audio.play()?.catch(() => undefined);
		else audio.pause();
	};

	const seekTo = (seconds: number) => {
		const audio = audioRef.current;
		if (!audio || !duration) return;
		audio.currentTime = Math.min(duration, Math.max(0, seconds));
		setPosition(audio.currentTime);
	};

	if (error) {
		return (
			<p className={cn("text-xs text-destructive", className)}>
				{t("card.audioUnavailable", { defaultValue: "Audio unavailable" })}
			</p>
		);
	}

	const progress =
		duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

	return (
		<div
			className={cn("flex min-w-0 items-center gap-2", className)}
			data-transcript-audio={path}
		>
			{url ? (
				// biome-ignore lint/a11y/useMediaCaption: the transcript is rendered right below the clip.
				<audio ref={audioRef} src={url} preload="metadata" data-studio-clip />
			) : null}
			<Button
				type="button"
				variant="secondary"
				size="icon"
				className="h-8 w-8 shrink-0 rounded-full"
				onClick={toggle}
				disabled={!url}
				aria-label={
					playing
						? t("card.pause", { defaultValue: "Pause" })
						: t("card.play", { defaultValue: "Play" })
				}
			>
				{!url ? (
					<Loader2 size={14} className="animate-spin" />
				) : playing ? (
					<Pause size={14} />
				) : (
					<Play size={14} className="translate-x-px" />
				)}
			</Button>
			<div
				role="slider"
				tabIndex={0}
				aria-label={t("card.seek", { defaultValue: "Seek" })}
				aria-valuemin={0}
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(position)}
				aria-valuetext={`${formatClock(position)} / ${formatClock(duration)}`}
				className="group relative h-6 min-w-0 flex-1 cursor-pointer"
				onPointerDown={(event) => {
					const rect = event.currentTarget.getBoundingClientRect();
					if (!rect.width) return;
					const ratio = Math.min(
						1,
						Math.max(0, (event.clientX - rect.left) / rect.width),
					);
					seekTo(ratio * duration);
				}}
				onKeyDown={(event) => {
					const audio = audioRef.current;
					if (!audio) return;
					if (event.key === "ArrowRight") seekTo(audio.currentTime + 5);
					else if (event.key === "ArrowLeft") seekTo(audio.currentTime - 5);
					else if (event.key === " " || event.key === "Enter") {
						event.preventDefault();
						toggle();
					}
				}}
			>
				<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
				<div
					className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
					style={{ width: `${progress}%` }}
				/>
				<div
					className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
					style={{ left: `${progress}%` }}
				/>
			</div>
			<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
				{formatClock(position)} / {formatClock(duration)}
			</span>
		</div>
	);
};
