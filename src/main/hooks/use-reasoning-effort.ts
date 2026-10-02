import { useCallback, useEffect, useState } from "react";
import {
	reasoningEffortKey,
	reasoningEffortSettings,
} from "@/services/llm/reasoning-effort-settings";
import type { ReasoningEffort } from "@/types/openai";
import { logWarn } from "@/utils/logger";
import type { SelectableModel } from "./selectable-model";

/**
 * The reasoning effort chosen for `model`, and a setter. Kept in step with
 * every other context, since the setting is shared by all chat surfaces.
 *
 * A saved level the model no longer accepts is dropped: every run sends the
 * saved level, and the provider refuses one the model does not list.
 */
export const useReasoningEffort = (
	model: Pick<SelectableModel, "id" | "provider" | "reasoning"> | undefined,
): readonly [
	ReasoningEffort | undefined,
	(effort: ReasoningEffort | undefined) => void,
] => {
	const key = model
		? reasoningEffortKey({ provider: model.provider, modelId: model.id })
		: null;
	// By value, so a refreshed model list does not reload the setting.
	const accepted = model?.reasoning?.efforts.join(",") ?? "";
	const [effort, setEffortState] = useState<ReasoningEffort | undefined>();

	useEffect(() => {
		setEffortState(undefined);
		if (!key) return;
		let active = true;
		const isAccepted = (level: ReasoningEffort | undefined) =>
			level !== undefined && accepted.split(",").includes(level);
		void reasoningEffortSettings
			.get(key)
			.then((stored) => {
				if (!active || stored === undefined) return;
				if (isAccepted(stored)) {
					setEffortState(stored);
					return;
				}
				return reasoningEffortSettings.set(key, undefined);
			})
			.catch((error) => logWarn("Failed to read the reasoning effort:", error));
		const unsubscribe = reasoningEffortSettings.subscribe(key, (changed) => {
			if (active) setEffortState(isAccepted(changed) ? changed : undefined);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [key, accepted]);

	const setEffort = useCallback(
		(next: ReasoningEffort | undefined) => {
			if (!key) return;
			setEffortState(next);
			void reasoningEffortSettings
				.set(key, next)
				.catch((error) =>
					logWarn("Failed to save the reasoning effort:", error),
				);
		},
		[key],
	);

	return [effort, setEffort] as const;
};
