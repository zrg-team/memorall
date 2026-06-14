import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, Download } from "lucide-react";
import type { ArtifactProps } from "./ArtifactActionsMenu";

// Use the GitHub Pages runner, same origin as the HyperFrames preview.
const RUNNER_URL = "https://zrg-team.github.io/memorall/lottie-preview.html?v=2";

export const LottieArtifact: React.FC<ArtifactProps> = ({
	content,
	identifier,
	title,
}) => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [playing, setPlaying] = useState(true);
	const [frame, setFrame] = useState(0);
	const [totalFrames, setTotalFrames] = useState(0);
	const [parseError, setParseError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let animationData: unknown;
		try {
			animationData = JSON.parse(content);
		} catch (error) {
			setParseError(error instanceof Error ? error.message : "Invalid JSON");
			return;
		}
		setParseError(null);

		const handleMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (event.data?.type === "lottie:ready") {
				setReady(true);
				setPlaying(true);
				setFrame(0);
				setTotalFrames(event.data.totalFrames ?? 0);
			}
			if (event.data?.type === "lottie:frame") {
				setFrame(event.data.frame ?? 0);
			}
		};
		window.addEventListener("message", handleMessage);

		const post = () =>
			iframeRef.current?.contentWindow?.postMessage(
				{ type: "lottie:load", animationData },
				"*",
			);
		const iframe = iframeRef.current;
		iframe?.addEventListener("load", post);
		if (ready) post();

		return () => {
			window.removeEventListener("message", handleMessage);
			iframe?.removeEventListener("load", post);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [content]);

	const togglePlay = () => {
		iframeRef.current?.contentWindow?.postMessage(
			{ type: playing ? "lottie:pause" : "lottie:play" },
			"*",
		);
		setPlaying(!playing);
	};

	const seek = (value: number) => {
		setFrame(value);
		iframeRef.current?.contentWindow?.postMessage(
			{ type: "lottie:seek", frame: value },
			"*",
		);
	};

	const handleDownload = () => {
		const blob = new Blob([content], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${(title || identifier || "animation").replace(/[^a-z0-9-]+/gi, "-")}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};

	if (parseError) {
		return (
			<div className="p-4 text-sm text-destructive">
				Invalid Lottie JSON: {parseError}
			</div>
		);
	}

	return (
		<div className="my-2 overflow-hidden rounded-md border bg-muted/20">
			<iframe
				ref={iframeRef}
				src={RUNNER_URL}
				sandbox="allow-scripts"
				className="w-full"
				style={{ height: "60vh", border: "none" }}
				title={title || identifier || "Lottie preview"}
			/>
			<div className="flex items-center gap-3 border-t bg-background px-3 py-2">
				<button
					onClick={togglePlay}
					className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
				>
					{playing ? <Pause size={14} /> : <Play size={14} />}
				</button>
				<input
					type="range"
					min={0}
					max={Math.max(totalFrames - 1, 0)}
					value={frame}
					onChange={(e) => seek(Number(e.target.value))}
					className="flex-1"
				/>
				<span className="font-mono text-xs text-muted-foreground">
					{frame}/{totalFrames}
				</span>
				<button
					onClick={handleDownload}
					title="Download JSON"
					className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
				>
					<Download size={14} />
				</button>
			</div>
		</div>
	);
};
