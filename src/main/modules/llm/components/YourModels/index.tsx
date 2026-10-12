import React, { useState, useEffect } from "react";
import { Loader2, Zap } from "lucide-react";
import { OpenAITab } from "@/main/modules/llm/components/OpenAITab";
import { OpenRouterTab } from "@/main/modules/llm/components/OpenRouterTab";
import { CustomProviderTab } from "../CustomProviderTab";
import { LocalOpenAITab } from "@/main/modules/llm/components/LocalOpenAITab";
import { useTranslation } from "react-i18next";

// Hooks
import { useProviderConfig } from "@/main/hooks/use-provider-config";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import { useLocalModels } from "@/main/modules/llm/hooks/use-local-models";
import { useDownloadProgress } from "@/main/modules/llm/hooks/use-download-progress";
import { useDownloadedModels } from "@/main/modules/llm/hooks/use-downloaded-models";
import { useModelOperations } from "@/main/modules/llm/hooks/use-model-operations";

// Components
import { ProgressSection } from "./components/ProgressSection";
import { DownloadedModelsSection } from "./components/DownloadedModelsSection";
import { ProviderSelector } from "./components/ProviderSelector";
import { LocalModelsList } from "./components/LocalModelsList";
import { QuickDownloadModels } from "./components/QuickDownloadModels";
import { RemoteModelsSection } from "./components/RemoteModelsSection";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

interface YourModelsProps {
	/** Optional callback when a model is loaded successfully */
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
	/** Whether to show the download more models button */
	showDownloadMoreButton?: boolean;
	/** Callback for download more models button */
	onDownloadMore?: () => void;
	/** Custom title for the section */
	title?: string;
	/** Show quick download section */
	showQuickDownload?: boolean;
	/** Show downloaded/currently available models section */
	showDownloadedModels?: boolean;
	/** Filter which providers to show (defaults to all) */
	allowedProviders?: ServiceProvider[];
}

export const YourModels: React.FC<YourModelsProps> = ({
	onModelLoaded,
	showDownloadMoreButton = false,
	onDownloadMore,
	title,
	showQuickDownload = true,
	showDownloadedModels = true,
	allowedProviders,
}) => {
	const { t } = useTranslation("llm");

	// Local state
	const [loading, setLoading] = useState(false);
	const [configRevision, setConfigRevision] = useState(0);

	// Custom hooks
	const {
		getState,
		setStateReady,
		setConfigExists,
		localConfigExists,
		setLocalConfigExists,
		quickProvider,
		setQuickProvider,
	} = useProviderConfig();

	const {
		downloadedModels,
		downloadedOnly,
		modelsLoading,
		fetchDownloadedModels,
	} = useDownloadedModels();

	const { current, setCurrent } = useCurrentModel();

	// Get provider-specific states
	const openaiState = getState("openai");
	const openrouterState = getState("openrouter");
	const customState = getState("custom");

	const { localModels, localModelsLoading } = useLocalModels(
		quickProvider,
		localConfigExists,
		quickProvider === "openai"
			? openaiState.ready
			: quickProvider === "openrouter"
				? openrouterState.ready
				: quickProvider === "custom"
					? customState.ready
					: undefined,
		configRevision,
	);
	const { localModels: openaiModels, localModelsLoading: openaiModelsLoading } =
		useLocalModels("openai", null, openaiState.ready);
	const {
		localModels: openrouterModels,
		localModelsLoading: openrouterModelsLoading,
	} = useLocalModels("openrouter", null, openrouterState.ready);
	const { localModels: customModels, localModelsLoading: customModelsLoading } =
		useLocalModels("custom", null, customState.ready, configRevision);

	const {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	} = useDownloadProgress();

	const {
		handleQuickDownload,
		loadDownloadedModel,
		unloadDownloadedModel,
		deleteDownloadedModel,
	} = useModelOperations({
		setCurrent,
		setLoading,
		setQuickDownloadModel,
		setDownloadProgress,
		fetchDownloadedModels,
		downloadedModels,
		onModelLoaded,
	});
	const remoteModelProviders: React.ComponentProps<
		typeof RemoteModelsSection
	>["providers"] = React.useMemo(
		() =>
			[
				{
					provider: "openai" as const,
					models: openaiModels,
					loading: openaiModelsLoading,
					ready: openaiState.ready,
				},
				{
					provider: "openrouter" as const,
					models: openrouterModels,
					loading: openrouterModelsLoading,
					ready: openrouterState.ready,
				},
				{
					provider: "custom" as const,
					models: customModels,
					loading: customModelsLoading,
					ready: customState.ready,
				},
			].filter(
				(providerState) =>
					!allowedProviders ||
					allowedProviders.includes(providerState.provider),
			),
		[
			allowedProviders,
			openaiModels,
			openaiModelsLoading,
			openaiState.ready,
			openrouterModels,
			openrouterModelsLoading,
			openrouterState.ready,
			customModels,
			customModelsLoading,
			customState.ready,
		],
	);

	// Ensure quickProvider is one of the allowed providers
	useEffect(() => {
		if (allowedProviders && !allowedProviders.includes(quickProvider)) {
			// Set to first allowed provider if current is not allowed
			setQuickProvider(allowedProviders[0]);
		}
	}, [allowedProviders]);

	// Auto-select provider if current model exists
	useEffect(() => {
		if (current?.provider && current.provider !== quickProvider) {
			setQuickProvider(current.provider);
		}
	}, [current?.provider]);

	return (
		<div className="space-y-6">
			{/* Progress Section */}
			<ProgressSection
				loading={loading}
				quickDownloadModel={quickDownloadModel}
				downloadProgress={downloadProgress}
			/>

			{/* Existing Downloaded Models */}
			{showDownloadedModels && (
				<>
					<RemoteModelsSection
						providers={remoteModelProviders}
						current={current}
						loading={loading}
						onModelLoaded={onModelLoaded}
					/>
					<DownloadedModelsSection
						downloadedOnly={downloadedOnly}
						current={current}
						title={title || t("yourModels.downloadedModels")}
						modelsLoading={modelsLoading}
						loading={loading}
						fetchDownloadedModels={fetchDownloadedModels}
						loadDownloadedModel={loadDownloadedModel}
						unloadDownloadedModel={unloadDownloadedModel}
						deleteDownloadedModel={deleteDownloadedModel}
						showDownloadMoreButton={showDownloadMoreButton}
						onDownloadMore={onDownloadMore}
					/>
				</>
			)}

			{/* Quick Download Recommended Models */}
			{showQuickDownload && (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold flex items-center gap-2">
							<Zap size={16} />
							{t("yourModels.quickDownload")}
						</h3>
						<ProviderSelector
							quickProvider={quickProvider}
							setQuickProvider={setQuickProvider}
							loading={loading}
							allowedProviders={allowedProviders}
						/>
					</div>

					{/* Config gating for OpenAI, OpenRouter and Local providers */}
					{(quickProvider === "openai" && !openaiState.ready) ||
					(quickProvider === "openrouter" && !openrouterState.ready) ||
					(quickProvider === "custom" && !customState.ready) ||
					((quickProvider === "lmstudio" || quickProvider === "ollama") &&
						!localConfigExists) ? (
						<div className="border rounded-lg p-4">
							{quickProvider === "openai" ? (
								<OpenAITab
									onModelLoaded={(modelId) => {
										setStateReady("openai", true);
										setConfigExists("openai", true);
										onModelLoaded?.(modelId, "openai");
									}}
								/>
							) : quickProvider === "openrouter" ? (
								<OpenRouterTab
									onModelLoaded={(modelId) => {
										setStateReady("openrouter", true);
										setConfigExists("openrouter", true);
										onModelLoaded?.(modelId, "openrouter");
									}}
								/>
							) : quickProvider === "custom" ? (
								<CustomProviderTab
									onConfigurationChange={(ready) => {
										setStateReady("custom", ready);
										setConfigExists("custom", ready);
										setConfigRevision((value) => value + 1);
									}}
								/>
							) : (
								<LocalOpenAITab
									providerKind={quickProvider as "lmstudio" | "ollama"}
									onModelLoaded={(modelId) => {
										onModelLoaded?.(modelId, "openai");
										setLocalConfigExists(true);
									}}
								/>
							)}
						</div>
					) : localModelsLoading &&
						(quickProvider === "lmstudio" ||
							quickProvider === "ollama" ||
							quickProvider === "openai" ||
							quickProvider === "openrouter" ||
							quickProvider === "custom") ? (
						<div className="flex items-center justify-center p-4 border rounded-lg">
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
							<span className="text-sm text-muted-foreground">
								{t("yourModels.loadingModels", { provider: quickProvider })}
							</span>
						</div>
					) : (
						<div className="grid gap-2">
							{quickProvider === "lmstudio" ||
							quickProvider === "ollama" ||
							quickProvider === "openai" ||
							quickProvider === "openrouter" ||
							quickProvider === "custom" ? (
								<LocalModelsList
									localModels={localModels}
									quickProvider={quickProvider}
									loading={loading}
									current={current}
									onModelLoaded={onModelLoaded}
								/>
							) : (
								<QuickDownloadModels
									quickProvider={quickProvider}
									downloadedModels={downloadedModels}
									downloadedOnly={downloadedOnly}
									localModels={localModels}
									loading={loading}
									quickDownloadModel={quickDownloadModel}
									current={current}
									handleQuickDownload={handleQuickDownload}
								/>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
