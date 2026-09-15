import { useState, useEffect } from "react";
import type { ProgressEvent } from "@/services/llm/interfaces/base-llm";
import { LLM_DOWNLOAD_PROGRESS_EVENT } from "@/services/llm/constants";
import {
	isKnownProvider,
	providerSupportsCategory,
} from "@/services/llm/provider-registry";

export interface DownloadProgress extends ProgressEvent {
	text: string;
}

/**
 * Whether a download event is for a chat model. Only those take over the app:
 * other kinds of model load from a studio, which shows its own progress.
 */
export function isChatModelDownload(detail: {
	category?: unknown;
	provider?: unknown;
}): boolean {
	if (typeof detail.category === "string") {
		return detail.category === "chat";
	}
	return !(
		isKnownProvider(detail.provider) &&
		!providerSupportsCategory(detail.provider, "chat")
	);
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
			if (detail && typeof detail === "object" && isChatModelDownload(detail)) {
				const progressData = {
					loaded: detail.loaded ?? 0,
					total: detail.total ?? 0,
					percent: detail.percent ?? 0,
					text: detail.text ?? "",
				};
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
