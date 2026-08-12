import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Pause, Play, Download, Send } from "lucide-react";
import type { ArtifactProps } from "./ArtifactActionsMenu";

// The preview and its runtime are packaged with the extension. Keeping this URL
// local is required by Manifest V3 and also makes previews work offline.
const RUNNER_URL =
	typeof chrome !== "undefined" && chrome.runtime?.getURL
		? chrome.runtime.getURL("sandbox/pages/lottie-preview.html?v=5")
		: "/sandbox/pages/lottie-preview.html?v=5";

const MAX_PREVIEW_ISSUES = 8;

export const LottieArtifact: React.FC<ArtifactProps> = ({
	content,
	identifier,
	title,
	onMessageAction,
}) => {
	const { t } = useTranslation("chat");
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [playing, setPlaying] = useState(true);
	const [frame, setFrame] = useState(0);
	const [totalFrames, setTotalFrames] = useState(0);
	const [parseError, setParseError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [previewIssues, setPreviewIssues] = useState<string[]>([]);

	useEffect(() => {
		let animationData: unknown;
		try {
			animationData = JSON.parse(content);
		} catch (error) {
			setParseError(error instanceof Error ? error.message : "Invalid JSON");
			return;
		}
		setParseError(null);
		setPreviewIssues([]);

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
			if (event.data?.type === "lottie:error") {
				const message =
					typeof event.data.message === "string"
						? event.data.message
						: "Unknown preview error";
				setPreviewIssues((prev) => {
					if (prev.includes(message)) return prev;
					return [...prev, message].slice(-MAX_PREVIEW_ISSUES);
				});
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

	const handleSendPreviewReport = useCallback(() => {
		if (previewIssues.length === 0) return;
		void onMessageAction?.({
			type: "artifact.preview.error.report",
			component: "lottie",
			title,
			identifier,
			payload: {
				errors: previewIssues,
			},
		});
	}, [identifier, onMessageAction, previewIssues, title]);

	if (parseError) {
		return (
			<div className="p-4 text-sm text-destructive">
				{t("lottiePreview.invalidJson", { error: parseError })}
			</div>
		);
	}

	return (
		<div className="my-2 overflow-hidden rounded-md border bg-muted/20">
			<div className="relative">
				<iframe
					ref={iframeRef}
					src={RUNNER_URL}
					sandbox="allow-scripts"
					className="w-full"
					style={{ height: "60vh", border: "none" }}
					title={title || identifier || t("lottiePreview.title")}
				/>
				{previewIssues.length > 0 ? (
					<div className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-destructive/35 bg-background/95 p-3 shadow-lg backdrop-blur">
						<div className="flex items-start gap-3">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							<div className="min-w-0 flex-1">
								<div className="text-xs font-semibold text-destructive">
									{t("lottiePreview.previewIssue", {
										count: previewIssues.length,
									})}
								</div>
								<div className="mt-1 max-h-20 space-y-1 overflow-auto font-mono text-[11px] leading-snug text-muted-foreground">
									{previewIssues.slice(-3).map((issue) => (
										<div key={issue} className="truncate" title={issue}>
											{issue}
										</div>
									))}
								</div>
							</div>
							<button
								type="button"
								onClick={handleSendPreviewReport}
								className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 text-xs font-medium text-destructive hover:bg-destructive/20"
								title={t("lottiePreview.sendToAgentTitle")}
							>
								<Send className="h-3.5 w-3.5" />
								<span>{t("lottiePreview.sendToAgent")}</span>
							</button>
						</div>
					</div>
				) : null}
			</div>
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
					title={t("lottiePreview.downloadJson")}
					className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
				>
					<Download size={14} />
				</button>
			</div>
		</div>
	);
};
