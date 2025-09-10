import { useCallback } from "react";
import { llmService, DEFAULT_SERVICES } from "@/services/llm";
import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatMessage,
} from "@/types/openai";
import { RECOMMENDATION_WEBLLM_LLMS } from "@/constants/webllm";
import { logError } from "@/utils/logger";
import secureSession from "@/utils/secure-session";
import { databaseService } from "@/services/database";
import { schema } from "@/services/database/db";
import { eq } from "drizzle-orm";
import { FIXED_ENCRYPTION_KEY } from "@/config/security";
import { deriveAesKeyFromString, decryptStringAes } from "@/utils/aes";
import type { FileInfo, ProgressData } from "./use-llm-state";

interface UseLLMActionsProps {
	// State setters
	setStatus: (status: string) => void;
	setLogs: (logs: string[] | ((prev: string[]) => string[])) => void;
	setLoading: (loading: boolean) => void;
	setReady: (ready: boolean) => void;
	setOutput: (output: string) => void;
	setWebllmAvailableModels: (models: string[]) => void;
	setAvailableFiles: (files: FileInfo[]) => void;
	setFilePath: (filePath: string) => void;
	setDownloadProgress: (progress: ProgressData) => void;
	setOpenaiApiKey: (key: string) => void;
	setOpenaiBaseUrl: (url: string) => void;
	setIsOpenaiConfigured: (configured: boolean) => void;

	// State values
	repo: string;
	filePath: string;
	ready: boolean;
	loading: boolean;
	prompt: string;
	webllmModel: string;
	openaiApiKey: string;
	openaiBaseUrl: string;
	isOpenaiConfigured: boolean;
}

export const useLLMActions = ({
	setStatus,
	setLogs,
	setLoading,
	setReady,
	setOutput,
	setWebllmAvailableModels,
	setAvailableFiles,
	setFilePath,
	setDownloadProgress,
	setOpenaiApiKey,
	setOpenaiBaseUrl,
	setIsOpenaiConfigured,
	repo,
	filePath,
	ready,
	prompt,
	webllmModel,
	openaiBaseUrl,
	isOpenaiConfigured,
}: UseLLMActionsProps) => {
	// Handle model loaded callback from YourModels component
	const handleModelLoaded = useCallback(
		(modelId: string, provider: string) => {
			setReady(true);
			setStatus(`${modelId} ${provider === "openai" ? "connected" : "loaded"}`);
			setLogs((l) => [
				...l,
				`[ui] ${modelId} ${provider === "openai" ? "connected" : "loaded"} successfully via YourModels (${provider})`,
			]);
		},
		[setReady, setStatus, setLogs],
	);

	// Initialize services using the centralized method
	const ensureServices = useCallback(async () => {
		await llmService.ensureAllServices();
	}, []);

	// Fetch available WebLLM models from API
	const fetchWebLLMModels = useCallback(async () => {
		setLogs((l) => [...l, "[ui] fetching available WebLLM models..."]);
		try {
			await ensureServices();
			const response = await llmService.modelsFor(DEFAULT_SERVICES.WEBLLM);
			const modelNames = response.data.map((model) => model.id);
			setWebllmAvailableModels(modelNames);
			setLogs((l) => [
				...l,
				`[ui] found ${modelNames.length} available WebLLM models`,
			]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			logError("Failed to fetch WebLLM models:", err);
			setLogs((l) => [...l, `[ui] failed to fetch WebLLM models: ${msg}`]);
			// Fallback to static models if API fails
			setWebllmAvailableModels(RECOMMENDATION_WEBLLM_LLMS);
			setLogs((l) => [...l, "[ui] using fallback WebLLM model list"]);
		}
	}, [ensureServices, setLogs, setWebllmAvailableModels]);

	const unloadModel = useCallback(async () => {
		setLoading(true);
		setStatus("Unloading...");
		try {
			await llmService.unload("");
			setReady(false);
			setOutput("");
			setStatus("Unloaded");
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		} finally {
			setLoading(false);
		}
	}, [setLoading, setStatus, setReady, setOutput]);

	// Fetch GGUF files for selected repo from Hugging Face API with file sizes
	const fetchRepoFiles = useCallback(
		async (repoInfo: string) => {
			setStatus("Fetching available files...");
			setLogs((l) => [...l, `[ui] fetch repo files: ${repoInfo}`]);
			try {
				const res = await fetch(
					`https://huggingface.co/api/models/${repoInfo}`,
				);
				if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
				const data: { siblings?: { rfilename: string; size?: number }[] } =
					await res.json();
				const files = (data.siblings || [])
					.filter((s) => s.rfilename.toLowerCase().endsWith(".gguf"))
					.map((s) => ({ name: s.rfilename, size: s.size || 0 }))
					.sort((a, b) => a.size - b.size); // Sort by size, smallest first

				setAvailableFiles(files);
				setLogs((l) => [...l, `[ui] found ${files.length} gguf files`]);
				if (files.length > 0) {
					setFilePath(files[0].name);
					setStatus("Ready to load model");
				} else {
					setFilePath("");
					setStatus("No GGUF files found in repo");
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				setAvailableFiles([]);
				setFilePath("");
				setStatus(`Failed to fetch files: ${msg}`);
				setLogs((l) => [...l, `[ui] fetch files error: ${msg}`]);
			}
		},
		[setStatus, setLogs, setAvailableFiles, setFilePath],
	);

	const loadWebLLMModel = useCallback(async () => {
		if (!webllmModel) {
			setStatus("Please select a WebLLM model");
			return;
		}
		setLoading(true);
		setStatus("Initializing...");
		setLogs((l) => [...l, "[ui] initialize webllm start"]);
		setDownloadProgress({ loaded: 0, total: 0, percent: 0, text: "" });

		try {
			await ensureServices();

			const modelId = webllmModel;

			setStatus("Loading WebLLM model...");
			setLogs((l) => [...l, `[ui] serve ${webllmModel}`]);

			await llmService.serveFor(
				DEFAULT_SERVICES.WEBLLM,
				modelId,
				(progress) => {
					setDownloadProgress({ text: "", ...progress });
					setStatus(`Loading... ${progress.percent}%`);
					setLogs((l) => [
						...l,
						`[progress] ${progress.percent}% (${progress.loaded}/${progress.total})`,
					]);
				},
			);

			setReady(true);
			setStatus("WebLLM model loaded");
			setLogs((l) => [...l, "[ui] webllm model loaded"]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (msg.includes("already initialized")) {
				setReady(true);
				setStatus("WebLLM model already loaded");
				setLogs((l) => [...l, "[ui] webllm model was already loaded"]);
			} else {
				setStatus(`Error: ${msg}`);
				setLogs((l) => [...l, `[ui] error: ${msg}`]);
			}
		} finally {
			setLoading(false);
		}
	}, [
		webllmModel,
		setStatus,
		setLoading,
		setLogs,
		setDownloadProgress,
		ensureServices,
		setReady,
	]);

	const loadModel = useCallback(async () => {
		if (!repo || !filePath) {
			setStatus("Please select a model repo and GGUF file");
			return;
		}
		setLoading(true);
		setStatus("Initializing...");
		setLogs((l) => [...l, "[ui] initialize start"]);
		setDownloadProgress({ loaded: 0, total: 0, percent: 0, text: "" });

		try {
			// Build 3-part model ID: username/repo/filename
			const modelId = `${repo}/${filePath}`;

			setStatus("Loading model from Hugging Face...");
			setLogs((l) => [...l, `[ui] serve ${repo}/${filePath}`]);
			await llmService.serve(modelId, (progress) => {
				setDownloadProgress({ text: "", ...progress });
				setStatus(`Loading... ${progress.percent}%`);
				setLogs((l) => [
					...l,
					`[progress] ${progress.percent}% (${progress.loaded}/${progress.total})`,
				]);
			});

			setReady(true);
			setStatus("Model loaded");
			setLogs((l) => [...l, "[ui] model loaded"]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (msg.includes("already initialized")) {
				setReady(true);
				setStatus("Model already loaded");
				setLogs((l) => [...l, "[ui] model was already loaded"]);
			} else {
				setStatus(`Error: ${msg}`);
				setLogs((l) => [...l, `[ui] error: ${msg}`]);
			}
		} finally {
			setLoading(false);
		}
	}, [
		repo,
		filePath,
		setStatus,
		setLoading,
		setLogs,
		setDownloadProgress,
		setReady,
	]);

	const generate = useCallback(async () => {
		if (!ready || !prompt.trim()) return;
		setLoading(true);
		setStatus("Generating...");
		setOutput("");
		setLogs((l) => [...l, "[ui] chat start"]);
		try {
			const messages: ChatMessage[] = [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: prompt },
			];

			const request: ChatCompletionRequest = {
				messages,
				max_tokens: 256,
				temperature: 0.2,
			};

			const response = (await llmService.chatCompletions(
				request,
			)) as ChatCompletionResponse;
			const text = response.choices[0].message.content;

			setOutput(text);
			setStatus("Done");
			setLogs((l) => [...l, `[ui] chat done, length=${text.length}`]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setStatus(`Error: ${msg}`);
			setLogs((l) => [...l, `[ui] error: ${msg}`]);
		} finally {
			setLoading(false);
		}
	}, [ready, prompt, setLoading, setStatus, setOutput, setLogs]);

	const handleProviderChange = useCallback(() => {
		setReady(false);
		setOutput("");
		setStatus("Select a model");
	}, [setReady, setOutput, setStatus]);

	const handleWebLLMTabSelect = useCallback(
		(webllmAvailableModels: string[]) => {
			// Fetch WebLLM models when switching to WebLLM tab
			if (webllmAvailableModels.length === 0) {
				fetchWebLLMModels();
			}
		},
		[fetchWebLLMModels],
	);

	// OpenAI-specific actions
	// Note: Persistent save is handled by OpenAITab with passkey and DB.
	// This helper only stores base URL in session for convenience and logs.
	const saveOpenAIConfig = useCallback(
		async (apiKey: string, baseUrl: string) => {
			setLoading(true);
			setStatus("Saving OpenAI configuration...");
			setLogs((l) => [...l, "[ui] updating OpenAI base URL in memory"]);

			try {
				await secureSession.set("openai_base_url", baseUrl);

				// Update state
				setOpenaiApiKey(""); // Never store plain key in state
				setOpenaiBaseUrl(baseUrl);
				setIsOpenaiConfigured(true);

				setStatus("OpenAI base URL saved");
				setLogs((l) => [...l, "[ui] OpenAI base URL stored in memory"]);
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				setStatus(`Error saving configuration: ${msg}`);
				setLogs((l) => [...l, `[ui] error saving OpenAI base URL: ${msg}`]);
			} finally {
				setLoading(false);
			}
		},
		[
			setLoading,
			setStatus,
			setLogs,
			setOpenaiApiKey,
			setOpenaiBaseUrl,
			setIsOpenaiConfigured,
		],
	);

	const testOpenAIConnection = useCallback(async () => {
		setLoading(true);
		setStatus("Testing OpenAI connection...");
		setLogs((l) => [...l, "[ui] testing OpenAI connection"]);

		try {
			// Create OpenAI service instance to test connection
			await llmService.create("openai-test", {
				type: "openai",
				apiKey: await getDecryptedOpenAIKey(),
				baseURL: openaiBaseUrl,
			});

			// Try to get models list
			const models = await llmService.modelsFor("openai-test");
			setStatus(`Connection successful - found ${models.data.length} models`);
			setLogs((l) => [
				...l,
				`[ui] OpenAI connection successful, ${models.data.length} models available`,
			]);

			// Clean up test service
			llmService.remove("openai-test");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setStatus(`Connection failed: ${msg}`);
			setLogs((l) => [...l, `[ui] OpenAI connection failed: ${msg}`]);
		} finally {
			setLoading(false);
		}
	}, [setLoading, setStatus, setLogs, openaiBaseUrl]);

	const clearOpenAIConfig = useCallback(() => {
		setOpenaiApiKey("");
		setOpenaiBaseUrl("https://api.openai.com/v1");
		setIsOpenaiConfigured(false);
		setReady(false);
		setOutput("");
		setStatus("OpenAI configuration cleared");
		setLogs((l) => [...l, "[ui] OpenAI configuration cleared from memory"]);

		// Clear from secure session
		secureSession.set("openai_base_url", "");
		secureSession.set("openai_combined_key", "");
		secureSession.set("openai_passkey", "");
	}, [
		setOpenaiApiKey,
		setOpenaiBaseUrl,
		setIsOpenaiConfigured,
		setReady,
		setOutput,
		setStatus,
		setLogs,
	]);

	const loadOpenAIModel = useCallback(async () => {
		if (!isOpenaiConfigured) {
			setStatus("Please configure OpenAI first");
			return;
		}

		setLoading(true);
		setStatus("Initializing OpenAI service...");
		setLogs((l) => [...l, "[ui] initializing OpenAI service"]);

		try {
			const decryptedKey = await getDecryptedOpenAIKey();

			await llmService.create("openai", {
				type: "openai",
				apiKey: decryptedKey,
				baseURL: openaiBaseUrl,
			});

			setReady(true);
			setStatus("OpenAI service ready");
			setLogs((l) => [...l, "[ui] OpenAI service initialized successfully"]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setStatus(`Error: ${msg}`);
			setLogs((l) => [...l, `[ui] error initializing OpenAI: ${msg}`]);
		} finally {
			setLoading(false);
		}
	}, [
		isOpenaiConfigured,
		setLoading,
		setStatus,
		setLogs,
		setReady,
		openaiBaseUrl,
	]);

	const getDecryptedOpenAIKey = useCallback(async (): Promise<string> => {
		// Try to use combined key from session (preferred)
		let combinedSecret = await secureSession.get("openai_combined_key");

		if (!combinedSecret) {
			// Fallback: derive from passkey + stored advanced seed
			const passkey = await secureSession.get("openai_passkey");
			if (!passkey) throw new Error("Missing OpenAI passkey in session");

			const row = (
				await databaseService.use(({ db }) => {
					return db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, "openai_config"));
				})
			)[0];
			if (!row?.advancedSeed)
				throw new Error("No advanced seed found for OpenAI config");

			const passkeyKey = await deriveAesKeyFromString(passkey);
			const strongPassword = await decryptStringAes(
				row.advancedSeed,
				passkeyKey,
			);
			combinedSecret = strongPassword + FIXED_ENCRYPTION_KEY;
			await secureSession.set("openai_combined_key", combinedSecret);
		}

		// Fetch encrypted data from DB and decrypt with combined key
		const encryptedRow = (
			await databaseService.use(({ db }) => {
				return db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, "openai_config"));
			})
		)[0];
		if (!encryptedRow?.encryptedData)
			throw new Error("No encrypted OpenAI data found");

		const aesKey = await deriveAesKeyFromString(combinedSecret);
		const decryptedJSON = await decryptStringAes(
			encryptedRow.encryptedData,
			aesKey,
		);
		const parsed = JSON.parse(decryptedJSON);
		if (!parsed?.apiKey) throw new Error("Invalid decrypted OpenAI config");
		return parsed.apiKey as string;
	}, []);

	const handleOpenAITabSelect = useCallback(() => {
		// Load existing configuration from secure session if available
		const loadExistingConfig = async () => {
			try {
				const ready = await secureSession.exists("openai_ready");
				const baseUrl = await secureSession.get("openai_base_url");

				if (ready && baseUrl) {
					setIsOpenaiConfigured(true);
					setOpenaiBaseUrl(baseUrl);
					setStatus("OpenAI configuration loaded from secure memory");
				}
			} catch (err) {
				// Ignore errors loading config
			}
		};
		loadExistingConfig();
	}, [setIsOpenaiConfigured, setOpenaiBaseUrl, setStatus]);

	return {
		handleModelLoaded,
		fetchWebLLMModels,
		unloadModel,
		fetchRepoFiles,
		loadWebLLMModel,
		loadModel,
		generate,
		handleProviderChange,
		handleWebLLMTabSelect,
		saveOpenAIConfig,
		testOpenAIConnection,
		clearOpenAIConfig,
		loadOpenAIModel,
		handleOpenAITabSelect,
	};
};
