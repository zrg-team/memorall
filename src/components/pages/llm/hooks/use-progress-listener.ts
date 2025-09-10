import { useEffect } from "react";
import type { ProgressData } from "./use-llm-state";

interface UseProgressListenerProps {
	setDownloadProgress: (progress: ProgressData) => void;
	setStatus: (status: string) => void;
	setLogs: (logs: string[] | ((prev: string[]) => string[])) => void;
}

export const useProgressListener = ({
	setDownloadProgress,
	setStatus,
	setLogs,
}: UseProgressListenerProps) => {
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
				setStatus(`Loading... ${d.percent ?? 0}%`);
				setLogs((l) => [
					...l,
					`[progress] ${d.percent ?? 0}% (${d.loaded ?? 0}/${d.total ?? 0})`,
				]);
			}
		};
		window.addEventListener("wllama:progress" as any, handler);
		return () => window.removeEventListener("wllama:progress" as any, handler);
	}, [setDownloadProgress, setStatus, setLogs]);
};
