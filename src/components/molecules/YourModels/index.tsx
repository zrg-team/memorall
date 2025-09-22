import React, { useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { OpenAITab } from "@/components/pages/llm/OpenAITab";
import { LocalOpenAITab } from "@/components/pages/llm/LocalOpenAITab";

// Hooks
import { useProviderConfig, type Provider } from "./hooks/use-provider-config";
import { useCurrentModel } from "./hooks/use-current-model";
import { useLocalModels } from "./hooks/use-local-models";
import { useDownloadProgress } from "./hooks/use-download-progress";
import { useDownloadedModels } from "./hooks/use-downloaded-models";
import { useModelOperations } from "./hooks/use-model-operations";

// Components
import { ProgressSection } from "./components/ProgressSection";
import { DownloadedModelsSection } from "./components/DownloadedModelsSection";
import { ProviderSelector } from "./components/ProviderSelector";
import { LocalModelsList } from "./components/LocalModelsList";
import { QuickDownloadModels } from "./components/QuickDownloadModels";

interface YourModelsProps {
	/** Optional callback when a model is loaded successfully */
	onModelLoaded?: (modelId: string, provider: Provider) => void;
	/** Whether to show the download more models button */
	showDownloadMoreButton?: boolean;
	/** Callback for download more models button */
	onDownloadMore?: () => void;
	/** Custom title for the section */
	title?: string;
	/** Show quick download section */
	showQuickDownload?: boolean;
}

export const YourModels: React.FC<YourModelsProps> = ({
	onModelLoaded,
	showDownloadMoreButton = false,
	onDownloadMore,
	title = "Your Models",
	showQuickDownload = true,
}) => {
	// Local state
	const [loading, setLoading] = useState(false);

	// Custom hooks
	const {
		openaiReady,
		setOpenaiReady,
		openaiPasskeyExists,
		setOpenaiPasskeyExists,
		openaiConfigExists,
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

	const { current, setCurrent } = useCurrentModel(
		openaiReady,
		downloadedModels.length,
	);

	const { localModels, localModelsLoading } = useLocalModels(
		quickProvider,
		localConfigExists,
	);

	const {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	} = useDownloadProgress();

	const { handleQuickDownload, loadDownloadedModel, unloadDownloadedModel } =
		useModelOperations({
			setCurrent,
			setLoading,
			setQuickDownloadModel,
			setDownloadProgress,
			fetchDownloadedModels,
			downloadedModels,
			onModelLoaded,
		});

	return (
		<div className="space-y-6">
			{/* Progress Section */}
			<ProgressSection
				loading={loading}
				quickDownloadModel={quickDownloadModel}
				downloadProgress={downloadProgress}
			/>

			{/* Existing Downloaded Models */}
			<DownloadedModelsSection
				downloadedOnly={downloadedOnly}
				current={current}
				title={title}
				modelsLoading={modelsLoading}
				loading={loading}
				fetchDownloadedModels={fetchDownloadedModels}
				loadDownloadedModel={loadDownloadedModel}
				unloadDownloadedModel={unloadDownloadedModel}
				showDownloadMoreButton={showDownloadMoreButton}
				onDownloadMore={onDownloadMore}
			/>

			{/* Quick Download Recommended Models */}
			{showQuickDownload && (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold flex items-center gap-2">
							<Zap size={16} />
							Quick Download
						</h3>
						<ProviderSelector
							quickProvider={quickProvider}
							setQuickProvider={setQuickProvider}
							loading={loading}
						/>
					</div>

					{/* Config gating for OpenAI and Local providers */}
					{(quickProvider === "openai" &&
						(!openaiConfigExists || !openaiPasskeyExists)) ||
					((quickProvider === "lmstudio" || quickProvider === "ollama") &&
						!localConfigExists) ? (
						<div className="border rounded-lg p-4">
							{quickProvider === "openai" ? (
								<OpenAITab
									onModelLoaded={(modelId) => {
										setOpenaiReady(true);
										setOpenaiPasskeyExists(true);
										onModelLoaded?.(modelId, "openai");
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
						(quickProvider === "lmstudio" || quickProvider === "ollama") ? (
						<div className="flex items-center justify-center p-4 border rounded-lg">
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
							<span className="text-sm text-muted-foreground">
								Loading {quickProvider} models...
							</span>
						</div>
					) : (
						<div className="grid gap-2">
							{quickProvider === "lmstudio" || quickProvider === "ollama" ? (
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
