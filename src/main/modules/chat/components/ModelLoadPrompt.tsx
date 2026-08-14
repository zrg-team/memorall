import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { getModel } from "@/services/llm/registry/model-registry";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";

type LocalRunnerProvider = "transformer" | "webllm" | "wllama";

function isLocalRunnerProvider(
	provider: ServiceProvider,
): provider is LocalRunnerProvider {
	return (
		provider === "transformer" || provider === "webllm" || provider === "wllama"
	);
}

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase();
}

interface DownloadProgress {
	loaded: number;
	total: number;
	percent: number;
	text: string;
}

export interface ModelLoadPromptProps {
	current: { provider: ServiceProvider; modelId: string } | null;
	onModelLoaded: (modelId?: string, provider?: ServiceProvider) => void;
	onDownloadProgress: (progress: DownloadProgress) => void;
	onDownloadModelName: (name: string | null) => void;
	onReadyChange: (isReady: boolean) => void;
}

export const ModelLoadPrompt: React.FC<ModelLoadPromptProps> = ({
	current,
	onModelLoaded,
	onDownloadProgress,
	onDownloadModelName,
	onReadyChange,
}) => {
	const { t } = useTranslation("chat");

	const [isCurrentModelLoaded, setIsCurrentModelLoaded] = useState(true);
	const [isCheckingCurrentModel, setIsCheckingCurrentModel] = useState(false);
	const [isLoadingCurrentModel, setIsLoadingCurrentModel] = useState(false);
	const [, setCurrentModelLoadError] = useState<string | null>(null);

	const currentLocalModel = useMemo(() => {
		if (!current || !isLocalRunnerProvider(current.provider)) return null;
		return getModel(current.modelId, current.provider) ?? null;
	}, [current]);

	const currentModelServeId = useMemo(() => {
		if (!current || !isLocalRunnerProvider(current.provider)) return null;
		if (
			current.provider === "wllama" &&
			currentLocalModel?.provider === "wllama" &&
			currentLocalModel.wllamaConfig?.filename
		) {
			return `${currentLocalModel.id}/${currentLocalModel.wllamaConfig.filename}`;
		}
		return currentLocalModel?.id ?? current.modelId;
	}, [current, currentLocalModel]);

	const currentModelDisplayName =
		currentLocalModel?.displayName ?? current?.modelId ?? "";

	useEffect(() => {
		let cancelled = false;

		if (!current || !isLocalRunnerProvider(current.provider)) {
			setIsCurrentModelLoaded(true);
			setIsCheckingCurrentModel(false);
			setCurrentModelLoadError(null);
			return;
		}

		const serviceName = PROVIDER_TO_SERVICE[current.provider];
		const candidateIds = [
			current.modelId,
			currentLocalModel?.id,
			currentModelServeId,
		].filter((v): v is string => Boolean(v));

		setIsCheckingCurrentModel(true);

		void serviceManager.llmService
			.modelsFor(serviceName)
			.then((response) => {
				if (cancelled) return;
				const loaded = response.data.some(
					(entry) =>
						entry.loaded &&
						candidateIds.some(
							(id) => normalizeModelId(id) === normalizeModelId(entry.id),
						),
				);
				setIsCurrentModelLoaded(loaded);
				if (loaded) setCurrentModelLoadError(null);
			})
			.catch((error) => {
				if (cancelled) return;
				logError("Failed to check current chat model status:", error);
				setIsCurrentModelLoaded(false);
			})
			.finally(() => {
				if (!cancelled) setIsCheckingCurrentModel(false);
			});

		return () => {
			cancelled = true;
		};
	}, [current, currentLocalModel, currentModelServeId]);

	const isChatInputModelReady =
		!current ||
		!isLocalRunnerProvider(current.provider) ||
		(isCurrentModelLoaded && !isCheckingCurrentModel && !isLoadingCurrentModel);

	useEffect(() => {
		onReadyChange(isChatInputModelReady);
	}, [isChatInputModelReady, onReadyChange]);

	const handleLoadCurrentModel = async () => {
		if (!current || !isLocalRunnerProvider(current.provider)) return;

		const serviceName = PROVIDER_TO_SERVICE[current.provider];
		const modelToServe = currentModelServeId ?? current.modelId;

		setCurrentModelLoadError(null);
		setIsLoadingCurrentModel(true);
		onDownloadModelName(currentModelDisplayName);
		onDownloadProgress({
			loaded: 0,
			total: 0,
			percent: 0,
			text: "Initializing...",
		});

		try {
			await serviceManager.llmService.serveFor(
				serviceName,
				modelToServe,
				(progress) => {
					onDownloadProgress({ ...progress, text: progress.text ?? "" });
				},
			);
			setIsCurrentModelLoaded(true);
			onModelLoaded(modelToServe, current.provider);
		} catch (error) {
			logError("Failed to load current model:", error);
			setCurrentModelLoadError(
				error instanceof Error ? error.message : "Failed to load model",
			);
			setIsCurrentModelLoaded(false);
		} finally {
			setIsLoadingCurrentModel(false);
			onDownloadModelName(null);
			onDownloadProgress({ loaded: 0, total: 0, percent: 0, text: "" });
		}
	};

	const shouldShow =
		Boolean(current && isLocalRunnerProvider(current.provider)) &&
		!isCurrentModelLoaded;

	if (!shouldShow) return null;

	return (
		<div className="relative z-30 w-full flex-shrink-0 px-4">
			<div className="max-w-4xl mx-auto">
				<div className="relative z-30 mx-5 -mb-px flex items-center justify-between gap-3 rounded-lg rounded-bl-none rounded-br-none border border-amber-500/30 bg-amber-500/10 px-3 py-2">
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
							<TriangleAlert className="w-3.5 h-3.5" />
							{t("model.selectedNotLoadedTitle")}
							{current?.provider ? (
								<Badge>
									{t("model.selectedProvider", {
										provider: current.provider,
									})}
								</Badge>
							) : null}
						</div>
						<div className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-100/80 break-words">
							{t("model.selectedNotLoadedDescription", {
								model: currentModelDisplayName,
							})}
						</div>
					</div>
					<Button
						type="button"
						size="sm"
						data-load-selected-model
						onClick={handleLoadCurrentModel}
						disabled={isLoadingCurrentModel}
						className="h-8 shrink-0 border border-amber-300 bg-amber-50 px-3 text-amber-950 hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-amber-200"
					>
						{isLoadingCurrentModel ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Play className="w-4 h-4" />
						)}
						{t("model.loadSelected")}
					</Button>
				</div>
			</div>
		</div>
	);
};
