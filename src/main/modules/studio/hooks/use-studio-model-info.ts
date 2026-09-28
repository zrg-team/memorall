import { useEffect, useState } from "react";
import { serviceManager } from "@/services";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";

/**
 * A model picked from the Hub becomes the selection before its service has
 * inspected and stored it (that happens as it starts serving), so the first
 * listing can miss it. Ask again briefly rather than leave the studio without
 * the model's options until the next reload.
 */
const MISSING_RETRIES = 10;
const MISSING_RETRY_MS = 1500;

/**
 * What the selected model reports about itself through its provider's
 * `models()` listing - voices, languages, image task. Studios build their
 * controls from this, so a new model brings its own options with it.
 */
export function useStudioModelInfo(model: CurrentModelInfo | null) {
	const [info, setInfo] = useState<ModelInfo | undefined>(undefined);
	const serviceName = model?.serviceName;
	const modelId = model?.modelId;

	useEffect(() => {
		setInfo(undefined);
		if (!serviceName || !modelId) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const target = modelId.toLowerCase();
		const lookup = (attempt: number) => {
			void serviceManager.llmService
				.modelsFor(serviceName)
				.then(({ data }) => {
					if (!active) return;
					const found = data.find((entry) => entry.id.toLowerCase() === target);
					if (found) {
						setInfo(found);
					} else if (attempt < MISSING_RETRIES) {
						timer = setTimeout(() => lookup(attempt + 1), MISSING_RETRY_MS);
					}
				})
				.catch(() => undefined);
		};
		lookup(0);
		return () => {
			active = false;
			if (timer) clearTimeout(timer);
		};
	}, [serviceName, modelId]);

	return info;
}
