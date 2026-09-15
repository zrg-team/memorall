import { Download, Loader2, Pause, Play } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { useMediaUrl } from "../../hooks/use-media-url";

interface AudioClipPlayerProps {
	path: string;
	mimeType: string;
	/** Known duration, shown before metadata loads. */
	durationMs?: number;
	/** Suggested filename for downloads, without extension. */
	downloadName?: string;
	compact?: boolean;
	className?: string;
}

const formatTime = (seconds: number) => {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const minutes = Math.floor(seconds / 60);
	const rest = Math.floor(seconds % 60);
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

/**
 * A stored audio clip: play/pause, a seekable progress track, time and a
 * download. Only one clip plays at a time across the page.
 */
export const AudioClipPlayer: React.FC<AudioClipPlayerProps> = ({
	path,
	mimeType,
	durationMs,
	downloadName = "audio",
	compact = false,
	className,
}) => {
	const { t } = useTranslation("studio");
	const { url, error } = useMediaUrl(path, mimeType);
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [position, setPosition] = useState(0);
	const [duration, setDuration] = useState((durationMs ?? 0) / 1000);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		const onTime = () => setPosition(audio.currentTime);
		const onMeta = () => {
			if (Number.isFinite(audio.duration)) setDuration(audio.duration);
		};
		const onPlay = () => {
			setPlaying(true);
			// Pause every other clip on the page.
			document.querySelectorAll("audio[data-studio-clip]").forEach((other) => {
				if (other !== audio) (other as HTMLAudioElement).pause();
			});
		};
		const onPause = () => setPlaying(false);
		audio.addEventListener("timeupdate", onTime);
		audio.addEventListener("loadedmetadata", onMeta);
		audio.addEventListener("play", onPlay);
		audio.addEventListener("pause", onPause);
		audio.addEventListener("ended", onPause);
		return () => {
			audio.removeEventListener("timeupdate", onTime);
			audio.removeEventListener("loadedmetadata", onMeta);
			audio.removeEventListener("play", onPlay);
			audio.removeEventListener("pause", onPause);
			audio.removeEventListener("ended", onPause);
		};
	}, [url]);

	const toggle = () => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) void audio.play();
		else audio.pause();
	};

	const seek = (event: React.PointerEvent<HTMLDivElement>) => {
		const audio = audioRef.current;
		if (!audio || !duration) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.min(
			1,
			Math.max(0, (event.clientX - rect.left) / rect.width),
		);
		audio.currentTime = ratio * duration;
		setPosition(audio.currentTime);
	};

	if (error) {
		return (
			<p className={cn("text-xs text-destructive", className)}>
				{t("player.unavailable", { defaultValue: "Audio unavailable" })}
			</p>
		);
	}

	const extension = mimeType.includes("wav")
		? "wav"
		: (mimeType.split("/")[1]?.split(";")[0] ?? "audio");
	const progress = duration > 0 ? (position / duration) * 100 : 0;

	return (
		<div
			className={cn("flex min-w-0 items-center gap-2", className)}
			data-audio-clip={path}
		>
			{url ? (
				// biome-ignore lint/a11y/useMediaCaption: generated speech has its transcript alongside.
				<audio ref={audioRef} src={url} preload="metadata" data-studio-clip />
			) : null}
			<Button
				type="button"
				variant="secondary"
				size="icon"
				className={cn("shrink-0 rounded-full", compact ? "h-7 w-7" : "h-9 w-9")}
				onClick={toggle}
				disabled={!url}
				aria-label={
					playing
						? t("player.pause", { defaultValue: "Pause" })
						: t("player.play", { defaultValue: "Play" })
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
				aria-label={t("player.seek", { defaultValue: "Seek" })}
				aria-valuemin={0}
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(position)}
				className="group relative h-6 min-w-0 flex-1 cursor-pointer"
				onPointerDown={seek}
				onKeyDown={(event) => {
					const audio = audioRef.current;
					if (!audio) return;
					if (event.key === "ArrowRight")
						audio.currentTime = Math.min(duration, audio.currentTime + 5);
					if (event.key === "ArrowLeft")
						audio.currentTime = Math.max(0, audio.currentTime - 5);
					if (event.key === " ") {
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
					className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100"
					style={{ left: `${progress}%` }}
				/>
			</div>
			<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
				{formatTime(position)} / {formatTime(duration)}
			</span>
			{url && !compact ? (
				<Button
					asChild
					type="button"
					variant="ghost"
					size="icon"
					className="h-8 w-8 shrink-0 text-muted-foreground"
				>
					<a
						href={url}
						download={`${downloadName}.${extension}`}
						aria-label={t("common.download", { defaultValue: "Download" })}
						title={t("common.download", { defaultValue: "Download" })}
					>
						<Download size={14} />
					</a>
				</Button>
			) : null}
		</div>
	);
};
