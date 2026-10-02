import { useCallback, useEffect, useState } from "react";
import {
	reasoningEffortKey,
	reasoningEffortSettings,
} from "@/services/llm/reasoning-effort-settings";
import type { ReasoningEffort } from "@/types/openai";
import { logWarn } from "@/utils/logger";
import type { CurrentModel } from "./use-current-model";

/**
 * The reasoning effort chosen for `model`, and a setter. Kept in step with
 * every other context, since the setting is shared by all chat surfaces.
 *
 * @param accepted the levels the provider's current list gives the model, or
 * undefined while that list has not come in. A saved level outside them is
 * dropped — every run sends the saved level, and the provider refuses one the
 * model does not list — but only on the list's word: a remembered list may be
 * out of date.
 */
export const useReasoningEffort = (
	model: CurrentModel | null | undefined,
	accepted: readonly ReasoningEffort[] | undefined,
): readonly [
	ReasoningEffort | undefined,
	(effort: ReasoningEffort | undefined) => void,
] => {
	const key = model ? reasoningEffortKey(model) : null;
	const [effort, setEffortState] = useState<ReasoningEffort | undefined>();

	useEffect(() => {
		setEffortState(undefined);
		if (!key) return;
		let active = true;
		void reasoningEffortSettings
			.get(key)
			.then((stored) => {
				if (active) setEffortState(stored);
			})
			.catch((error) => logWarn("Failed to read the reasoning effort:", error));
		const unsubscribe = reasoningEffortSettings.subscribe(key, (changed) => {
			if (active) setEffortState(changed);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [key]);

	// By value, so a refreshed list does not count as a change.
	const acceptedLevels = accepted?.join(",");
	useEffect(() => {
		if (!key || acceptedLevels === undefined || !effort) return;
		if (acceptedLevels.split(",").includes(effort)) return;
		setEffortState(undefined);
		void reasoningEffortSettings
			.set(key, undefined)
			.catch((error) =>
				logWarn("Failed to clear the reasoning effort:", error),
			);
	}, [key, acceptedLevels, effort]);

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
