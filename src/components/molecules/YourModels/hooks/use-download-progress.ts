import { useState, useEffect } from "react";

export interface DownloadProgress {
	loaded: number;
	total: number;
	percent: number;
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

	// Progress listener for wllama
	useEffect(() => {
		const handler = (e: any) => {
			if (e?.type === "wllama:progress") {
				const d = e.detail || {};
				setDownloadProgress({
					loaded: d.loaded ?? 0,
					total: d.total ?? 0,
					percent: d.percent ?? 0,
					text: "",
				});
			}
		};
		window.addEventListener("wllama:progress" as any, handler);
		return () => window.removeEventListener("wllama:progress" as any, handler);
	}, []);

	return {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	};
}
