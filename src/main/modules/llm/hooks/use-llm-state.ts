import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { useState } from "react";
import { RECOMMENDATION_WALLAMA_LLMS } from "@/constants/wllama";
import { RECOMMENDATION_TRANSFORMER_MODELS } from "@/constants/transformer";

export interface FileInfo {
	name: string;
	size: number;
}

export interface ProgressData {
	loaded: number;
	total: number;
	percent: number;
	text: string;
}

export const useLLMState = () => {
	const [repo, setRepo] = useState(RECOMMENDATION_WALLAMA_LLMS[0]);
	const [filePath, setFilePath] = useState("");
	const [availableFiles, setAvailableFiles] = useState<FileInfo[]>([]);
	const [advancedProvider, setAdvancedProvider] =
		useState<ServiceProvider>("transformer");
	// Which kind of model the page is browsing; narrows providers and lists.
	const [modelCategory, setModelCategory] = useState<WorkspaceMode>("chat");
	// Generic model state - used by all providers
	const [model, setModel] = useState(RECOMMENDATION_TRANSFORMER_MODELS[0]);
	const [webllmAvailableModels, setWebllmAvailableModels] = useState<string[]>(
		[],
	);
	const [customRepo, setCustomRepo] = useState("");
	const [useCustomRepo, setUseCustomRepo] = useState(false);
	const [status, setStatus] = useState<string>("Idle");
	const [logs, setLogs] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [prompt, setPrompt] = useState(
		"Write a short haiku about browser extensions.",
	);
	const [output, setOutput] = useState("");
	const [ready, setReady] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<ProgressData>({
		loaded: 0,
		total: 0,
		percent: 0,
		text: "",
	});

	// OpenAI-specific state
	const [openaiApiKey, setOpenaiApiKey] = useState("");
	const [openaiBaseUrl, setOpenaiBaseUrl] = useState(
		"https://api.openai.com/v1",
	);
	const [isOpenaiConfigured, setIsOpenaiConfigured] = useState(false);

	return {
		// State values
		repo,
		filePath,
		availableFiles,
		advancedProvider,
		modelCategory,
		model,
		webllmAvailableModels,
		customRepo,
		useCustomRepo,
		status,
		logs,
		loading,
		prompt,
		output,
		ready,
		downloadProgress,
		openaiApiKey,
		openaiBaseUrl,
		isOpenaiConfigured,

		// State setters
		setRepo,
		setFilePath,
		setAvailableFiles,
		setAdvancedProvider,
		setModelCategory,
		setModel,
		setWebllmAvailableModels,
		setCustomRepo,
		setUseCustomRepo,
		setStatus,
		setLogs,
		setLoading,
		setPrompt,
		setOutput,
		setReady,
		setDownloadProgress,
		setOpenaiApiKey,
		setOpenaiBaseUrl,
		setIsOpenaiConfigured,
	};
};
