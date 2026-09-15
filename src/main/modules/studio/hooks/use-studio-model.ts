import { useCallback, useEffect, useRef, useState } from "react";
import { serviceManager } from "@/services";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { isResidentLocalProvider } from "@/services/llm/provider-registry";
import { useCategoryCurrentModel } from "./use-category-current-model";

export interface StudioModelLoadState {
	status: "idle" | "loading" | "ready" | "error";
	percent: number;
	error?: string;
}

/**
 * The selected model for a studio and a way to make sure it is in memory.
 *
 * Local models lazy-load on first use anyway, but a first use can mean a
 * multi-hundred-megabyte download. Loading explicitly first is what lets the
 * studio show a progress bar instead of a generate button that hangs.
 */
export function useStudioModel(mode: MediaCategory) {
	const { current, loading } = useCategoryCurrentModel(mode);
	const [load, setLoad] = useState<StudioModelLoadState>({
		status: "idle",
		percent: 0,
	});
	const loadingFor = useRef<string | null>(null);

	const keyOf = (model: CurrentModelInfo | null) =>
		model ? `${model.serviceName}:${model.modelId}` : null;

	useEffect(() => {
		setLoad({ status: "idle", percent: 0 });
		loadingFor.current = null;
	}, [current?.serviceName, current?.modelId]);

	const ensureReady = useCallback(async (): Promise<CurrentModelInfo> => {
		if (!current) {
			throw new Error("Choose a model first");
		}
		if (!isResidentLocalProvider(current.provider)) {
			return current;
		}
		const key = keyOf(current);
		loadingFor.current = key;
		setLoad({ status: "loading", percent: 0 });
		try {
			await serviceManager.llmService.serveFor(
				current.serviceName,
				current.modelId,
				(progress) => {
					if (loadingFor.current !== key) return;
					setLoad({ status: "loading", percent: Math.round(progress.percent) });
				},
				{ category: mode },
			);
			if (loadingFor.current === key)
				setLoad({ status: "ready", percent: 100 });
			return current;
		} catch (error) {
			if (loadingFor.current === key) {
				setLoad({
					status: "error",
					percent: 0,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		}
	}, [current, mode]);

	return { current, loading, load, ensureReady };
}
