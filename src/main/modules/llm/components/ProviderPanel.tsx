import React from "react";
import { Settings, Sparkles } from "lucide-react";
import { eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";

import { Button } from "@/main/components/ui/button";
import { ChatSection } from "./ChatSection";
import { LogsSection } from "./LogsSection";
import { LocalOpenAITab } from "./LocalOpenAITab";
import { OpenAITab } from "./OpenAITab";
import { OpenRouterTab } from "./OpenRouterTab";
import { ProgressSection } from "./ProgressSection";
import { ProviderTabs, type ProviderStatus } from "./ProviderTabs";
import { RecommendedSetup } from "./RecommendedSetup";
import { TransformerTab } from "./TransformerTab";
import { WebLLMTab } from "./WebLLMTab";
import { WllamaTab } from "./WllamaTab";
import { LocalModelsList } from "./YourModels/components/LocalModelsList";
import { QuickDownloadModels } from "./YourModels/components/QuickDownloadModels";
import { RemoteModelsSection } from "./YourModels/components/RemoteModelsSection";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import { useDownloadedModels } from "../hooks/use-downloaded-models";
import { useDownloadProgress } from "../hooks/use-download-progress";
import { useLocalModels } from "../hooks/use-local-models";
import { useModelOperations } from "../hooks/use-model-operations";
import { serviceManager } from "@/services";
import secureSession from "@/utils/secure-session";
import type { FileInfo, ProgressData } from "../hooks/use-llm-state";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

interface ProviderPanelProps {
	repo: string;
	setRepo: (repo: string) => void;
	filePath: string;
	setFilePath: (filePath: string) => void;
	availableFiles: FileInfo[];
	setAvailableFiles: (files: FileInfo[]) => void;
	advancedProvider: ServiceProvider;
	setAdvancedProvider: (provider: ServiceProvider) => void;
	model: string;
	setModel: (model: string) => void;
	webllmAvailableModels: string[];
	customRepo: string;
	setCustomRepo: (repo: string) => void;
	useCustomRepo: boolean;
	setUseCustomRepo: (use: boolean) => void;
	status: string;
	logs: string[];
	loading: boolean;
	prompt: string;
	setPrompt: (prompt: string) => void;
	output: string;
	ready: boolean;
	downloadProgress: ProgressData;
	onLoadProviderModel: (
		provider: ServiceProvider,
		modelId?: string,
	) => Promise<void>;
	onUnloadModel: () => Promise<void>;
	onGenerate: () => Promise<void>;
	onFetchRepoFiles: (repoInfo: string) => Promise<void>;
	onProviderChange: () => void;
	onWebLLMTabSelect: (webllmAvailableModels: string[]) => void;
	onOpenAITabSelect: () => void;
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
}

type PanelMode = "recommended" | "browse";

const PROVIDERS: ServiceProvider[] = [
	"transformer",
	"wllama",
	"webllm",
	"openai",
	"openrouter",
	"lmstudio",
	"ollama",
];

const CONFIG_KEYS: Partial<Record<ServiceProvider, string>> = {
	openai: "openai_config",
	openrouter: "openrouter_config",
	lmstudio: "lmstudio_config",
	ollama: "ollama_config",
};

const READY_KEYS: Partial<Record<ServiceProvider, string>> = {
	openai: "openai_ready",
	openrouter: "openrouter_ready",
};

export const ProviderPanel: React.FC<ProviderPanelProps> = ({
	repo,
	setRepo,
	filePath,
	setFilePath,
	availableFiles,
	setAvailableFiles,
	advancedProvider,
	setAdvancedProvider,
	model,
	setModel,
	webllmAvailableModels,
	customRepo,
	setCustomRepo,
	useCustomRepo,
	setUseCustomRepo,
	status,
	logs,
	loading,
	prompt,
	setPrompt,
	output,
	ready,
	downloadProgress,
	onLoadProviderModel,
	onUnloadModel,
	onGenerate,
	onFetchRepoFiles,
	onProviderChange,
	onWebLLMTabSelect,
	onOpenAITabSelect,
	onModelLoaded,
}) => {
	const { t } = useTranslation("llm");
	const { current, setCurrent, isInitialized } = useCurrentModel();
	const [showTestInference, setShowTestInference] = React.useState(false);
	// Land on "Recommended" for anyone without a model yet, and on the provider
	// surface for anyone who already has one — unless they pick a mode first.
	const [mode, setMode] = React.useState<PanelMode>("recommended");
	const modeResolved = React.useRef(false);
	const selectMode = React.useCallback((next: PanelMode) => {
		modeResolved.current = true;
		setMode(next);
	}, []);

	React.useEffect(() => {
		if (modeResolved.current || !isInitialized) {
			return;
		}
		modeResolved.current = true;
		if (current?.modelId?.trim()) {
			setMode("browse");
		}
	}, [isInitialized, current]);

	const [providerStatuses, setProviderStatuses] = React.useState<
		Record<ServiceProvider, ProviderStatus>
	>(() =>
		PROVIDERS.reduce(
			(accumulator, provider) => ({ ...accumulator, [provider]: "idle" }),
			{} as Record<ServiceProvider, ProviderStatus>,
		),
	);
	const { downloadedModels, downloadedOnly, fetchDownloadedModels } =
		useDownloadedModels();
	const {
		downloadProgress: quickDownloadProgress,
		setDownloadProgress: setQuickDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	} = useDownloadProgress();
	const [quickLoading, setQuickLoading] = React.useState(false);
	const openaiModels = useLocalModels(
		"openai",
		null,
		providerStatuses.openai !== "idle",
	);
	const openrouterModels = useLocalModels(
		"openrouter",
		null,
		providerStatuses.openrouter !== "idle",
	);
	const lmstudioModels = useLocalModels(
		"lmstudio",
		providerStatuses.lmstudio !== "idle",
	);
	const ollamaModels = useLocalModels(
		"ollama",
		providerStatuses.ollama !== "idle",
	);
	const { handleQuickDownload } = useModelOperations({
		setCurrent,
		setLoading: setQuickLoading,
		setQuickDownloadModel,
		setDownloadProgress: setQuickDownloadProgress,
		fetchDownloadedModels,
		downloadedModels,
		onModelLoaded,
	});

	React.useEffect(() => {
		let cancelled = false;
		const refreshStatuses = async () => {
			const nextStatuses = {} as Record<ServiceProvider, ProviderStatus>;
			for (const provider of PROVIDERS) {
				if (current?.provider === provider) {
					nextStatuses[provider] = "active";
					continue;
				}

				const readyKey = READY_KEYS[provider];
				const configKey = CONFIG_KEYS[provider];
				const hasService = serviceManager.llmService.has(provider);
				const hasReadySession = readyKey
					? await secureSession.exists(readyKey)
					: false;
				const hasSavedConfig = configKey
					? await serviceManager.databaseService
							.use(({ db, schema }) => {
								const table =
									provider === "openai" || provider === "openrouter"
										? schema.encryption
										: schema.configurations;
								return db
									.select()
									.from(table)
									.where(eq(table.key, configKey))
									.limit(1);
							})
							.then((rows) => rows.length > 0)
							.catch(() => false)
					: false;
				nextStatuses[provider] =
					hasService || hasReadySession || hasSavedConfig
						? "configured"
						: "idle";
			}
			if (!cancelled) {
				setProviderStatuses(nextStatuses);
			}
		};
		refreshStatuses();
		return () => {
			cancelled = true;
		};
	}, [advancedProvider, current]);

	const quickDownloads = (provider: ServiceProvider) => (
		<QuickDownloadModels
			quickProvider={provider}
			downloadedModels={downloadedModels}
			downloadedOnly={downloadedOnly}
			localModels={[]}
			loading={quickLoading}
			quickDownloadModel={quickDownloadModel}
			current={current}
			handleQuickDownload={handleQuickDownload}
		/>
	);

	const showGlobalProgress =
		loading &&
		(advancedProvider === "wllama" ||
			advancedProvider === "webllm" ||
			advancedProvider === "transformer");
	const activeRemoteProvider =
		advancedProvider === "openai" || advancedProvider === "openrouter"
			? advancedProvider
			: null;
	const activeLocalModels =
		advancedProvider === "lmstudio"
			? lmstudioModels
			: advancedProvider === "ollama"
				? ollamaModels
				: null;

	const modeSwitch = (
		<div
			role="tablist"
			aria-label={t("providerPanel.modes.label")}
			className="flex gap-1 rounded-lg border bg-muted/20 p-1"
		>
			{(
				[
					{ value: "recommended" as const, icon: true },
					{ value: "browse" as const, icon: false },
				] satisfies Array<{ value: PanelMode; icon: boolean }>
			).map(({ value, icon }) => {
				const isActive = mode === value;
				return (
					<Button
						key={value}
						type="button"
						role="tab"
						aria-selected={isActive}
						data-panel-mode={value}
						variant="ghost"
						onClick={() => selectMode(value)}
						className={`min-h-9 flex-1 gap-1.5 rounded-md px-3 text-xs font-medium transition-colors sm:text-sm ${
							isActive
								? "bg-background text-foreground shadow-sm ring-1 ring-border"
								: "text-muted-foreground hover:bg-background/60 hover:text-foreground"
						}`}
					>
						{icon && <Sparkles className="h-4 w-4" />}
						{t(`providerPanel.modes.${value}`)}
					</Button>
				);
			})}
		</div>
	);

	if (mode === "recommended") {
		return (
			<div className="space-y-3 px-2 py-2 sm:px-3 lg:px-4">
				{modeSwitch}
				<RecommendedSetup
					onModelLoaded={onModelLoaded}
					onBrowseAll={() => selectMode("browse")}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-3 px-2 py-2 sm:px-3 lg:px-4">
			{modeSwitch}

			<ProviderTabs
				advancedProvider={advancedProvider}
				setAdvancedProvider={setAdvancedProvider}
				loading={loading || quickLoading}
				onProviderChange={onProviderChange}
				onWebLLMTabSelect={onWebLLMTabSelect}
				webllmAvailableModels={webllmAvailableModels}
				onOpenAITabSelect={onOpenAITabSelect}
				providerStatuses={providerStatuses}
			/>

			{quickLoading && (
				<ProgressSection
					loading={quickLoading}
					advancedProvider={advancedProvider}
					filePath={filePath}
					repo={repo}
					model={quickDownloadModel ?? model}
					downloadProgress={quickDownloadProgress}
				/>
			)}

			{showGlobalProgress && (
				<ProgressSection
					loading={loading}
					advancedProvider={advancedProvider}
					filePath={filePath}
					repo={repo}
					model={model}
					downloadProgress={downloadProgress}
				/>
			)}

			{advancedProvider === "wllama" && (
				<WllamaTab
					repo={repo}
					setRepo={setRepo}
					filePath={filePath}
					setFilePath={setFilePath}
					availableFiles={availableFiles}
					setAvailableFiles={setAvailableFiles}
					customRepo={customRepo}
					setCustomRepo={setCustomRepo}
					useCustomRepo={useCustomRepo}
					setUseCustomRepo={setUseCustomRepo}
					loading={loading}
					ready={ready}
					onFetchRepoFiles={onFetchRepoFiles}
					onLoadModel={() => onLoadProviderModel("wllama")}
					onUnloadModel={onUnloadModel}
					quickDownloads={quickDownloads("wllama")}
				/>
			)}

			{advancedProvider === "webllm" && (
				<WebLLMTab
					model={model}
					setModel={setModel}
					webllmAvailableModels={webllmAvailableModels}
					loading={loading}
					ready={ready}
					onLoadAdvancedModel={() => onLoadProviderModel("webllm")}
					onUnloadModel={onUnloadModel}
					quickDownloads={quickDownloads("webllm")}
				/>
			)}

			{advancedProvider === "transformer" && (
				<TransformerTab
					model={model}
					setModel={setModel}
					loading={loading}
					ready={ready}
					onLoadAdvancedModel={() => onLoadProviderModel("transformer")}
					onUnloadModel={onUnloadModel}
					quickDownloads={quickDownloads("transformer")}
				/>
			)}

			{advancedProvider === "openai" && (
				<OpenAITab onModelLoaded={onModelLoaded} />
			)}

			{advancedProvider === "openrouter" && (
				<OpenRouterTab onModelLoaded={onModelLoaded} />
			)}

			{advancedProvider === "lmstudio" && (
				<LocalOpenAITab providerKind="lmstudio" onModelLoaded={onModelLoaded} />
			)}

			{advancedProvider === "ollama" && (
				<LocalOpenAITab providerKind="ollama" onModelLoaded={onModelLoaded} />
			)}

			{activeRemoteProvider && (
				<RemoteModelsSection
					providers={[
						{
							provider: activeRemoteProvider,
							models:
								activeRemoteProvider === "openai"
									? openaiModels.localModels
									: openrouterModels.localModels,
							loading:
								activeRemoteProvider === "openai"
									? openaiModels.localModelsLoading
									: openrouterModels.localModelsLoading,
							ready: providerStatuses[activeRemoteProvider] !== "idle",
						},
					]}
					current={current}
					loading={loading}
					onModelLoaded={onModelLoaded}
				/>
			)}

			{activeLocalModels && (
				<LocalModelsList
					localModels={activeLocalModels.localModels}
					quickProvider={advancedProvider}
					loading={loading || activeLocalModels.localModelsLoading}
					current={current}
					onModelLoaded={onModelLoaded}
				/>
			)}

			<div className="text-sm text-muted-foreground">
				{t("providerPanel.status", { status })}
			</div>

			<section className="rounded-lg border">
				<Button
					type="button"
					variant="ghost"
					className="h-auto w-full justify-start gap-2 rounded-none p-3 text-left text-sm font-medium disabled:text-muted-foreground"
					onClick={() => setShowTestInference((value) => !value)}
					disabled={!ready}
				>
					<Settings className="h-4 w-4" />
					{t("providerPanel.testInference")}
				</Button>
				{showTestInference && ready && (
					<div className="space-y-4 border-t p-3">
						<ChatSection
							ready={ready}
							prompt={prompt}
							setPrompt={setPrompt}
							loading={loading}
							onGenerate={onGenerate}
							output={output}
						/>
						<LogsSection logs={logs} />
					</div>
				)}
			</section>
		</div>
	);
};
