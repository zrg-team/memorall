import React from "react";
import { ArrowRight, Settings, Sparkles } from "lucide-react";
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
import { MediaModelsTab } from "./MediaModelsTab";
import { ModelCategoryChips } from "./ModelCategoryChips";
import { useCategoryCurrentModel } from "@/main/modules/studio/hooks/use-category-current-model";
import {
	isMediaCategory,
	type WorkspaceMode,
} from "@/services/llm/interfaces/model-category";
import { BrowserSupportNotice } from "./BrowserSupportNotice";
import { getProviderSupport } from "../utils/browser-support";
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
import {
	LOCAL_RUNNER_PROVIDERS,
	PROVIDER_ORDER,
	PROVIDER_REGISTRY,
	providersForCategory,
} from "@/services/llm/provider-registry";
import { useSelectableModels } from "@/main/hooks/use-selectable-models";
import { preferredProvider } from "../utils/preferred-provider";

interface ProviderPanelProps {
	repo: string;
	setRepo: (repo: string) => void;
	filePath: string;
	setFilePath: (filePath: string) => void;
	availableFiles: FileInfo[];
	setAvailableFiles: (files: FileInfo[]) => void;
	advancedProvider: ServiceProvider;
	setAdvancedProvider: (provider: ServiceProvider) => void;
	/** Controlled by the models page; standalone uses keep their own. */
	modelCategory?: WorkspaceMode;
	setModelCategory?: (category: WorkspaceMode) => void;
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

const PROVIDERS = PROVIDER_ORDER;

const CONFIG_KEYS: Partial<Record<ServiceProvider, string>> =
	Object.fromEntries(
		PROVIDER_ORDER.flatMap((provider) => {
			const descriptor = PROVIDER_REGISTRY[provider];
			const key = descriptor.encryptionKey ?? descriptor.configKey;
			return key ? [[provider, key]] : [];
		}),
	);

const READY_KEYS: Partial<Record<ServiceProvider, string>> = Object.fromEntries(
	PROVIDER_ORDER.flatMap((provider) => {
		const key = PROVIDER_REGISTRY[provider].readyKey;
		return key ? [[provider, key]] : [];
	}),
);

export const ProviderPanel: React.FC<ProviderPanelProps> = ({
	repo,
	setRepo,
	filePath,
	setFilePath,
	availableFiles,
	setAvailableFiles,
	advancedProvider,
	setAdvancedProvider,
	modelCategory: controlledCategory,
	setModelCategory: setControlledCategory,
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
	const [localCategory, setLocalCategory] =
		React.useState<WorkspaceMode>("chat");
	const modelCategory = controlledCategory ?? localCategory;
	const setModelCategory = setControlledCategory ?? setLocalCategory;
	const { current: chatCurrent, setCurrent, isInitialized } = useCurrentModel();
	const { current: categoryCurrent, loading: categoryCurrentLoading } =
		useCategoryCurrentModel(modelCategory);
	const isChatCategory = modelCategory === "chat";
	// Everything that marks "the active model" follows the category on screen.
	const current = isChatCategory ? chatCurrent : categoryCurrent;
	const categoryProviders = React.useMemo(
		() => providersForCategory(modelCategory),
		[modelCategory],
	);

	// A provider that cannot serve the chosen kind of model is not a tab any
	// more; land on the first one that can rather than on an empty panel.
	React.useEffect(() => {
		if (!categoryProviders.includes(advancedProvider) && categoryProviders[0]) {
			setAdvancedProvider(categoryProviders[0]);
		}
	}, [advancedProvider, categoryProviders, setAdvancedProvider]);
	const advancedProviderSupport = getProviderSupport(advancedProvider);
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
		if (chatCurrent?.modelId?.trim()) {
			setMode("browse");
		}
	}, [isInitialized, chatCurrent]);

	const [statusesReady, setStatusesReady] = React.useState(false);
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
				setStatusesReady(true);
			}
		};
		refreshStatuses();
		return () => {
			cancelled = true;
		};
	}, [advancedProvider, current]);

	// Open the tab the user most likely wants: where the selected model lives,
	// then where downloaded models are, then a provider already set up. Once
	// they pick a tab for this category themselves, it is left alone.
	const selectable = useSelectableModels(modelCategory);
	const userPickedCategory = React.useRef<WorkspaceMode | null>(null);
	const currentReady = isChatCategory ? isInitialized : !categoryCurrentLoading;
	const preferred = React.useMemo(() => {
		if (!currentReady || !selectable.isListed || !statusesReady) {
			return null;
		}
		const downloadedProviders = new Set<ServiceProvider>();
		for (const [provider, models] of selectable.byProvider) {
			if (LOCAL_RUNNER_PROVIDERS.has(provider) && models.length > 0) {
				downloadedProviders.add(provider);
			}
		}
		const configuredProviders = new Set(
			categoryProviders.filter(
				(provider) =>
					CONFIG_KEYS[provider] && providerStatuses[provider] !== "idle",
			),
		);
		return preferredProvider({
			providers: categoryProviders,
			currentProvider: current?.provider,
			downloadedProviders,
			configuredProviders,
		});
	}, [
		currentReady,
		selectable.isListed,
		selectable.byProvider,
		statusesReady,
		categoryProviders,
		providerStatuses,
		current?.provider,
	]);

	React.useEffect(() => {
		if (userPickedCategory.current === modelCategory) return;
		if (preferred && preferred !== advancedProvider) {
			setAdvancedProvider(preferred);
		}
	}, [preferred, modelCategory, advancedProvider, setAdvancedProvider]);

	const pickProvider = React.useCallback(
		(provider: ServiceProvider) => {
			userPickedCategory.current = modelCategory;
			setAdvancedProvider(provider);
		},
		[modelCategory, setAdvancedProvider],
	);

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

	// The mode switch rides on whichever row the mode already has, rather than
	// owning a full-width bar of its own. Two stacked strips read as two tab
	// rows with no cue as to which was the mode and which the provider.
	const recommendedPill = (
		<Button
			type="button"
			data-panel-mode="recommended"
			aria-pressed={false}
			variant="ghost"
			onClick={() => selectMode("recommended")}
			title={t("providerPanel.modes.recommended")}
			aria-label={t("providerPanel.modes.recommended")}
			// Icon-only: the seven provider tabs already fill this strip, and a
			// spelled-out label pushed the last one off the edge. Tailwind
			// breakpoints track the viewport, not this container, so a
			// responsive label cannot be sized reliably here.
			className="min-h-9 w-9 shrink-0 rounded-md p-0 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
		>
			<Sparkles className="h-4 w-4" />
		</Button>
	);

	const browseLink = (
		<Button
			type="button"
			data-panel-mode="browse"
			variant="ghost"
			size="sm"
			onClick={() => selectMode("browse")}
			className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
		>
			{t("providerPanel.modes.browse")}
			<ArrowRight className="h-3.5 w-3.5" />
		</Button>
	);

	const categoryChips = (
		<ModelCategoryChips
			category={modelCategory}
			onChange={(next) => {
				setModelCategory(next);
				// The guided setup only knows chat models.
				if (next !== "chat") selectMode("browse");
			}}
			disabled={loading || quickLoading}
		/>
	);

	if (mode === "recommended" && isChatCategory) {
		return (
			<div className="space-y-3 px-2 py-2 sm:px-3 lg:px-4">
				{categoryChips}
				<RecommendedSetup
					onModelLoaded={onModelLoaded}
					onBrowseAll={() => selectMode("browse")}
					browseAction={browseLink}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-3 px-2 py-2 sm:px-3 lg:px-4">
			{categoryChips}
			<ProviderTabs
				providers={categoryProviders}
				advancedProvider={advancedProvider}
				setAdvancedProvider={pickProvider}
				loading={loading || quickLoading}
				onProviderChange={onProviderChange}
				onWebLLMTabSelect={onWebLLMTabSelect}
				webllmAvailableModels={webllmAvailableModels}
				onOpenAITabSelect={onOpenAITabSelect}
				providerStatuses={providerStatuses}
				leading={isChatCategory ? recommendedPill : undefined}
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

			{advancedProviderSupport.supported ? null : (
				<BrowserSupportNotice
					provider={advancedProvider}
					reason={advancedProviderSupport.reason}
				/>
			)}

			{advancedProviderSupport.supported && advancedProvider === "wllama" && (
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

			{advancedProviderSupport.supported && advancedProvider === "webllm" && (
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

			{isMediaCategory(modelCategory) &&
				advancedProvider === "transformer-media" && (
					<MediaModelsTab category={modelCategory} />
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
					category={modelCategory}
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

			{isChatCategory ? (
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
			) : null}
		</div>
	);
};
