import { useEffect, useState } from "react";
import { platform } from "@/platform/current";
import type { ModelReasoning } from "@/services/llm/interfaces/base-llm";
import { reasoningEffortKey } from "@/services/llm/reasoning-effort-settings";
import type { CurrentModel } from "./use-current-model";
import type { SelectableModel } from "./selectable-model";

/** The reasoning controls each model's listing gave last time, by model. */
export const MODEL_REASONING_STORAGE_KEY = "memorall.chat.modelReasoning";

type ReasoningByModel = Partial<Record<string, ModelReasoning>>;

const readAll = async (): Promise<ReasoningByModel> => {
	try {
		return (
			(await platform.persistentStore.get<ReasoningByModel>(
				MODEL_REASONING_STORAGE_KEY,
			)) ?? {}
		);
	} catch {
		return {};
	}
};

const remember = async (
	modelKey: string,
	reasoning: ModelReasoning | undefined,
): Promise<void> => {
	const { [modelKey]: _previous, ...others } = await readAll();
	await platform.persistentStore.set(
		MODEL_REASONING_STORAGE_KEY,
		reasoning ? { ...others, [modelKey]: reasoning } : others,
	);
};

/**
 * The selected model's reasoning controls.
 *
 * They come with the provider's model list, which loads after the page does —
 * later still while a provider is not ready — and the controls should not wait
 * for it. Until the list has the model, the controls it listed last time stand
 * in; each time it does, they are remembered again.
 */
export const useModelReasoning = (
	current: CurrentModel | null | undefined,
	listed: Pick<SelectableModel, "reasoning"> | undefined,
): ModelReasoning | undefined => {
	const key = current ? reasoningEffortKey(current) : null;
	const [cached, setCached] = useState<ModelReasoning | undefined>();

	useEffect(() => {
		setCached(undefined);
		if (!key) return;
		let active = true;
		void readAll().then((byModel) => {
			if (active) setCached(byModel[key]);
		});
		return () => {
			active = false;
		};
	}, [key]);

	// By value: a refreshed list hands over equal controls as new objects.
	const listedReasoning = listed
		? JSON.stringify(listed.reasoning ?? null)
		: undefined;
	useEffect(() => {
		if (!key || listedReasoning === undefined) return;
		const reasoning = JSON.parse(listedReasoning) as ModelReasoning | null;
		void remember(key, reasoning ?? undefined).catch(() => undefined);
	}, [key, listedReasoning]);

	return listed ? listed.reasoning : cached;
};
