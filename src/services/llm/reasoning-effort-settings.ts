import { sharedStorageService } from "@/services/shared-storage/shared-storage-service";
import type { ReasoningEffort } from "@/types/openai";
import { isReasoningEffort } from "./utils/reasoning";

/**
 * The reasoning effort chosen for each model.
 *
 * The composer sets it and every chat run reads it — the Chat, the agent
 * wizard and the co-agent all run through the same job — so it lives in shared
 * storage rather than with any one of them. A model with no entry thinks at its
 * own default.
 */
const STORAGE_KEY = "reasoningEffortByModel";

type EffortByModel = Partial<Record<string, ReasoningEffort>>;

/** One model as the setting knows it: the same id under another provider is another model. */
export const reasoningEffortKey = (model: {
	provider: string;
	modelId: string;
}): string => `${model.provider}:${model.modelId}`;

const readAll = async (): Promise<EffortByModel> =>
	(await sharedStorageService.get<EffortByModel>(STORAGE_KEY)) ?? {};

export const reasoningEffortSettings = {
	async get(modelKey: string): Promise<ReasoningEffort | undefined> {
		const effort = (await readAll())[modelKey];
		return isReasoningEffort(effort) ? effort : undefined;
	},

	/** `undefined` goes back to the model's default. */
	async set(
		modelKey: string,
		effort: ReasoningEffort | undefined,
	): Promise<void> {
		const { [modelKey]: _previous, ...others } = await readAll();
		await sharedStorageService.set<EffortByModel>(
			STORAGE_KEY,
			effort ? { ...others, [modelKey]: effort } : others,
		);
	},

	/** Called with the model's effort whenever any context changes it. */
	subscribe(
		modelKey: string,
		listener: (effort: ReasoningEffort | undefined) => void,
	): () => void {
		return sharedStorageService.subscribe<EffortByModel>(
			STORAGE_KEY,
			(event) => {
				const effort = event.newValue?.[modelKey];
				listener(isReasoningEffort(effort) ? effort : undefined);
			},
		);
	},
};
