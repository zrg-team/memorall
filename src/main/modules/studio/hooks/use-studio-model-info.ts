import { useEffect, useState } from "react";
import { serviceManager } from "@/services";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";

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
		const target = modelId.toLowerCase();
		void serviceManager.llmService
			.modelsFor(serviceName)
			.then(({ data }) => {
				if (active)
					setInfo(data.find((entry) => entry.id.toLowerCase() === target));
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [serviceName, modelId]);

	return info;
}
