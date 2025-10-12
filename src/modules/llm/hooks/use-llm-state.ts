import { useState } from "react";
import { RECOMMENDATION_WALLAMA_LLMS } from "@/constants/wllama";

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
	const [advancedProvider, setAdvancedProvider] = useState<
		"wllama" | "webllm" | "openai" | "lmstudio" | "ollama"
	>("wllama");
	const [webllmModel, setWebllmModel] = useState("");
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
		webllmModel,
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
		setWebllmModel,
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
