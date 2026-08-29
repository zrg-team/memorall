import { detectSystemSpecs } from "@/main/modules/llm/utils/system-detection";
import {
	engineForProvider,
	getAvailableModelMemoryGB,
} from "@/main/modules/llm/utils/model-memory";
import { getModelRuntimeProfile } from "../registry/model-registry";

export interface RunnerMemoryHint {
	/** Budget for the backend this model was catalogued against. */
	availableGB: number;
	/**
	 * Budget when the runner offloads to the GPU. wllama decides that at load
	 * time from the device's own capability, not from the catalogue, so it needs
	 * the VRAM figure alongside the RAM one to size a context window correctly.
	 */
	webgpuAvailableGB: number;
	/**
	 * The model-specific figures, absent for a model no catalogue entry covers.
	 * A runner that can measure them itself — wllama reads them from the GGUF
	 * header — fills the gap; the device budget above is useful either way.
	 */
	sizeGB?: number;
	kvBytesPerToken?: number;
	contextLength?: number;
	usesWebGPU: boolean;
}

export type RunnerMemoryHintProvider = "transformer" | "webllm" | "wllama";

export async function buildRunnerMemoryHint(
	modelId: string | undefined,
	provider: RunnerMemoryHintProvider,
	specs: Awaited<ReturnType<typeof detectSystemSpecs>> | null,
): Promise<RunnerMemoryHint | undefined> {
	if (!modelId || !specs) {
		return undefined;
	}

	const modelProfile = getModelRuntimeProfile(modelId, provider);

	// A model outside the catalogue — any custom Hugging Face repo — still runs
	// on this device, so it still needs the device's budget. Returning nothing
	// left those models with no budget to size a context window against, so they
	// asked for the ceiling and relied on the load failing to find a size that
	// fits. The runner fills in the model-specific figures it can measure.
	if (!modelProfile) {
		return {
			availableGB: getAvailableModelMemoryGB(specs, false),
			webgpuAvailableGB: getAvailableModelMemoryGB(
				specs,
				true,
				engineForProvider(provider),
			),
			usesWebGPU: false,
		};
	}

	return {
		availableGB: getAvailableModelMemoryGB(
			specs,
			modelProfile.requiresWebGPU,
			engineForProvider(provider),
		),
		webgpuAvailableGB: getAvailableModelMemoryGB(
			specs,
			true,
			engineForProvider(provider),
		),
		sizeGB: modelProfile.sizeGB,
		kvBytesPerToken: modelProfile.kvBytesPerToken,
		contextLength: modelProfile.contextLength,
		usesWebGPU: modelProfile.requiresWebGPU,
	};
}
