import React from "react";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { ProgressSection } from "./ProgressSection";
import { ProviderTabs } from "./ProviderTabs";
import { WllamaTab } from "./WllamaTab";
import { WebLLMTab } from "./WebLLMTab";
import { OpenAITab } from "./OpenAITab";
import { LocalOpenAITab } from "./LocalOpenAITab";
import { ChatSection } from "./ChatSection";
import { LogsSection } from "./LogsSection";

interface FileInfo {
	name: string;
	size: number;
}

interface ProgressData {
	loaded: number;
	total: number;
	percent: number;
	text: string;
}

interface AdvancedSectionProps {
	// State props
	repo: string;
	setRepo: (repo: string) => void;
	filePath: string;
	setFilePath: (filePath: string) => void;
	availableFiles: FileInfo[];
	setAvailableFiles: (files: FileInfo[]) => void;
	advancedProvider: "wllama" | "webllm" | "openai" | "lmstudio" | "ollama";
	setAdvancedProvider: (
		provider: "wllama" | "webllm" | "openai" | "lmstudio" | "ollama",
	) => void;
	webllmModel: string;
	setWebllmModel: (model: string) => void;
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
	openaiApiKey: string;
	setOpenaiApiKey: (key: string) => void;
	openaiBaseUrl: string;
	setOpenaiBaseUrl: (url: string) => void;
	isOpenaiConfigured: boolean;
	setIsOpenaiConfigured: (configured: boolean) => void;

	// Action props
	onLoadModel: () => Promise<void>;
	onLoadWebLLMModel: () => Promise<void>;
	onUnloadModel: () => Promise<void>;
	onGenerate: () => Promise<void>;
	onFetchRepoFiles: (repoInfo: string) => Promise<void>;
	onProviderChange: () => void;
	onWebLLMTabSelect: (webllmAvailableModels: string[]) => void;
	onOpenAITabSelect: () => void;
	onModelLoaded?: (
		modelId: string,
		provider: "wllama" | "webllm" | "openai",
	) => void;
}

export const AdvancedSection: React.FC<AdvancedSectionProps> = ({
	repo,
	setRepo,
	filePath,
	setFilePath,
	availableFiles,
	setAvailableFiles,
	advancedProvider,
	setAdvancedProvider,
	webllmModel,
	setWebllmModel,
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
	onLoadModel,
	onLoadWebLLMModel,
	onUnloadModel,
	onGenerate,
	onFetchRepoFiles,
	onProviderChange,
	onWebLLMTabSelect,
	onOpenAITabSelect,
	onModelLoaded,
}) => {
	return (
		<Card className="rounded-none md:rounded-lg">
			<CardHeader className="p-3">
				<CardTitle className="flex items-center gap-2">
					<Settings size={20} />
					Advanced - Download New Model
				</CardTitle>
				<CardDescription>
					Download and run models locally via worker - supports both Wllama
					(GGUF) and WebLLM (MLC)
				</CardDescription>
			</CardHeader>
			<CardContent className="p-3 space-y-4">
				<ProgressSection
					loading={loading}
					advancedProvider={advancedProvider}
					filePath={filePath}
					repo={repo}
					webllmModel={webllmModel}
					downloadProgress={downloadProgress}
				/>

				<ProviderTabs
					advancedProvider={advancedProvider}
					setAdvancedProvider={setAdvancedProvider}
					loading={loading}
					onProviderChange={onProviderChange}
					onWebLLMTabSelect={onWebLLMTabSelect}
					webllmAvailableModels={webllmAvailableModels}
					onOpenAITabSelect={onOpenAITabSelect}
				/>

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
						onFetchRepoFiles={onFetchRepoFiles}
					/>
				)}

				{advancedProvider === "webllm" && (
					<WebLLMTab
						webllmModel={webllmModel}
						setWebllmModel={setWebllmModel}
						webllmAvailableModels={webllmAvailableModels}
						loading={loading}
					/>
				)}

				{advancedProvider === "openai" && (
					<OpenAITab onModelLoaded={onModelLoaded} />
				)}

				{advancedProvider === "lmstudio" && (
					<LocalOpenAITab
						providerKind="lmstudio"
						onModelLoaded={onModelLoaded}
					/>
				)}

				{advancedProvider === "ollama" && (
					<LocalOpenAITab providerKind="ollama" onModelLoaded={onModelLoaded} />
				)}

				{(advancedProvider === "wllama" || advancedProvider === "webllm") && (
					<div className="flex gap-2">
						<Button
							onClick={
								advancedProvider === "wllama" ? onLoadModel : onLoadWebLLMModel
							}
							disabled={
								loading ||
								ready ||
								(advancedProvider === "wllama"
									? !repo || !filePath
									: !webllmModel)
							}
						>
							Load Model
						</Button>
						<Button
							onClick={onUnloadModel}
							variant="outline"
							disabled={loading || !ready}
						>
							Unload
						</Button>
					</div>
				)}

				<div className="text-sm text-muted-foreground">Status: {status}</div>

				<ChatSection
					ready={ready}
					prompt={prompt}
					setPrompt={setPrompt}
					loading={loading}
					onGenerate={onGenerate}
					output={output}
				/>

				<LogsSection logs={logs} />
			</CardContent>
		</Card>
	);
};
