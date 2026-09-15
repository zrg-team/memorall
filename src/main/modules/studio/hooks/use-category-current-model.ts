import { useEffect, useState } from "react";
import { serviceManager } from "@/services";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";

/** The model selected for one category, kept live across contexts. */
export function useCategoryCurrentModel(category: WorkspaceMode) {
	const [current, setCurrent] = useState<CurrentModelInfo | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const llm = serviceManager.llmService;
		setLoading(true);
		void llm
			.getCurrentModelFor(category)
			.then((model) => {
				if (!cancelled) setCurrent(model);
			})
			.catch(() => {
				if (!cancelled) setCurrent(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		const unsubscribe = llm.onCurrentModelsChange((changed, model) => {
			if (changed === category && !cancelled) setCurrent(model);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [category]);

	return { current, loading };
}
