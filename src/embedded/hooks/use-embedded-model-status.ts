import { useCallback, useEffect, useState } from "react";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { logError, logInfo } from "@/utils/logger";

type EncryptedProvider = "openai" | "openrouter" | "custom";

export const useEmbeddedModelStatus = () => {
	const [selectedModel, setSelectedModel] = useState<string>("");
	const [selectedProvider, setSelectedProvider] = useState<string>("");
	const [modelAvailable, setModelAvailable] = useState(false);
	const [needsPasskey, setNeedsPasskey] = useState(false);
	const [noModelConfig, setNoModelConfig] = useState(false);
	const [encryptedProviders, setEncryptedProviders] = useState<string[]>([]);

	const checkProvidersNeedRestore = useCallback(async () => {
		const providers: EncryptedProvider[] = ["openai", "openrouter", "custom"];
		const checks = await Promise.all(
			providers.map(async (provider) => {
				const checkResult = await backgroundJob.createJob(
					"check-provider-needs-restore",
					{ provider },
					{ stream: false },
				);

				if (!("promise" in checkResult)) {
					return { provider, needsRestore: false };
				}

				const checkJobResult = await checkResult.promise;
				return {
					provider,
					needsRestore:
						checkJobResult.status === "completed" &&
						!!checkJobResult.result?.needsRestore,
				};
			}),
		);

		const restoringProviders = checks
			.filter((check) => check.needsRestore)
			.map((check) => check.provider);

		return {
			needsRestore: restoringProviders.length > 0,
			providers: restoringProviders,
		};
	}, []);

	const refreshModelStatus = useCallback(async () => {
		try {
			const result = await backgroundJob.createJob(
				"get-current-model",
				{},
				{ stream: false },
			);

			if (!("promise" in result)) {
				return;
			}

			const jobResult = await result.promise;
			logInfo("[EmbeddedChat] Initialize model", jobResult);

			if (jobResult.status !== "completed" || !jobResult.result) {
				return;
			}

			const modelInfo = jobResult.result.modelInfo;
			if (
				modelInfo &&
				typeof modelInfo === "object" &&
				"modelId" in modelInfo &&
				"provider" in modelInfo
			) {
				const provider = `${modelInfo.provider}`;
				setSelectedModel(`${modelInfo.modelId}`);
				setSelectedProvider(provider);

				if (
					provider === "openai" ||
					provider === "openrouter" ||
					provider === "custom"
				) {
					const restoreState = await checkProvidersNeedRestore();
					if (restoreState.needsRestore) {
						logInfo(
							`[EmbeddedChat] Provider restore required: ${restoreState.providers.join(", ")}`,
						);
						setEncryptedProviders(restoreState.providers);
						setNeedsPasskey(true);
						setModelAvailable(false);
						return;
					}
				}

				setNeedsPasskey(false);
				setEncryptedProviders([]);
				setNoModelConfig(false);
				setModelAvailable(true);
				return;
			}

			const restoreState = await checkProvidersNeedRestore();
			if (restoreState.needsRestore) {
				logInfo(
					`[EmbeddedChat] No model loaded and encrypted providers need restore: ${restoreState.providers.join(", ")}`,
				);
				setEncryptedProviders(restoreState.providers);
				setNeedsPasskey(true);
				setModelAvailable(false);
				return;
			}

			setNeedsPasskey(false);
			setEncryptedProviders([]);
			setNoModelConfig(true);
			setModelAvailable(false);
		} catch (error) {
			logError("[EmbeddedChat] Initialize model failed", error);
			setModelAvailable(false);
		}
	}, [checkProvidersNeedRestore]);

	useEffect(() => {
		void refreshModelStatus();
	}, [refreshModelStatus]);

	return {
		selectedModel,
		selectedProvider,
		modelAvailable,
		needsPasskey,
		noModelConfig,
		encryptedProviders,
		refreshModelStatus,
	};
};
