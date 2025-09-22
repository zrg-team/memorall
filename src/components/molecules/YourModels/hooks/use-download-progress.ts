import { useState, useEffect } from "react";
import type { ProgressEvent } from "@/services/llm/interfaces/base-llm";
import { LLM_DOWNLOAD_PROGRESS_EVENT } from "@/services/llm/constants";

export interface DownloadProgress extends ProgressEvent {
	text: string;
}

export function useDownloadProgress() {
	const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
		loaded: 0,
		total: 0,
		percent: 0,
		text: "",
	});

	const [quickDownloadModel, setQuickDownloadModel] = useState<string | null>(
		null,
	);

	// Listen for progress events from background jobs
	useEffect(() => {
		const handleProgressEvent = (event: CustomEvent) => {
			const detail = event.detail;
			if (detail && typeof detail === "object") {
				const progressData = {
					loaded: detail.loaded ?? 0,
					total: detail.total ?? 0,
					percent: detail.percent ?? 0,
					text: detail.text ?? "",
				};
				console.log("📊 Setting progress:", progressData);
				setDownloadProgress(progressData);
			}
		};

		// Listen for global LLM download progress event
		window.addEventListener(
			LLM_DOWNLOAD_PROGRESS_EVENT,
			handleProgressEvent as EventListener,
		);

		return () => {
			window.removeEventListener(
				LLM_DOWNLOAD_PROGRESS_EVENT,
				handleProgressEvent as EventListener,
			);
		};
	}, []);

	return {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	};
}
