import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serviceManager } from "@/services";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { MediaPipelineTask } from "@/services/llm/interfaces/media-model-config";
import {
	MEDIA_CATEGORIES,
	type MediaCategory,
} from "@/services/llm/interfaces/model-category";
import { providerSupportsCategory } from "@/services/llm/provider-registry";
import {
	CATEGORY_TASKS,
	TASK_CATEGORY,
} from "@/services/llm/registry/media-model-registry";
import {
	type HubModelSummary,
	hubBrowseUrl,
	removeMediaModel,
	repoIdFromInput,
	searchHubModels,
} from "@/services/llm/registry/media-model-store";

const LOCAL_MEDIA_SERVICE = PROVIDER_TO_SERVICE["transformer-media"];

/** Every category an on-device model can serve, in switcher order. */
export const LOCAL_MEDIA_CATEGORIES: readonly MediaCategory[] =
	MEDIA_CATEGORIES.filter(
		(category) =>
			providerSupportsCategory("transformer-media", category) &&
			(CATEGORY_TASKS[category]?.length ?? 0) > 0,
	);

export type HubCategoryFilter = MediaCategory | "all";
export type HubTaskFilter = MediaPipelineTask | "all";

/**
 * On-device models: the ones already added, and Hub search to add more. It
 * starts on one studio's category and can widen to every tool or narrow to one
 * pipeline task. "Use" works for any result - the service inspects and stores
 * an unknown repo on its first serve, and records it for its own category.
 */
export function useHubMediaModels(category: MediaCategory) {
	const [allInstalled, setAllInstalled] = useState<ModelInfo[]>([]);
	const [results, setResults] = useState<HubModelSummary[]>([]);
	const [query, setQuery] = useState("");
	const [filter, setFilterState] = useState<HubCategoryFilter>(category);
	const [task, setTask] = useState<HubTaskFilter>("all");
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [percent, setPercent] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const searchSeq = useRef(0);

	useEffect(() => {
		setFilterState(category);
		setTask("all");
	}, [category]);

	const setFilter = (next: HubCategoryFilter) => {
		setFilterState(next);
		setTask("all");
	};

	const tasksOfFilter = useMemo<MediaPipelineTask[]>(
		() =>
			filter === "all"
				? LOCAL_MEDIA_CATEGORIES.flatMap((item) => CATEGORY_TASKS[item] ?? [])
				: [...(CATEGORY_TASKS[filter] ?? [])],
		[filter],
	);
	const searchedTasks = useMemo(
		() => (task === "all" ? tasksOfFilter : [task]),
		[task, tasksOfFilter],
	);

	const refreshInstalled = useCallback(async () => {
		try {
			const { data } =
				await serviceManager.llmService.modelsFor(LOCAL_MEDIA_SERVICE);
			setAllInstalled(data);
		} catch {
			setAllInstalled([]);
		}
	}, []);

	const installed = useMemo(
		() =>
			filter === "all"
				? allInstalled
				: allInstalled.filter((model) => model.categories?.includes(filter)),
		[allInstalled, filter],
	);

	const search = useCallback(
		async (text: string) => {
			const seq = ++searchSeq.current;
			setSearching(true);
			setSearchError(null);
			try {
				const found = await searchHubModels(null, text, {
					tasks: searchedTasks,
					// Every tool at once is many tasks: fewer results from each.
					limit: searchedTasks.length > 4 ? 10 : 20,
				});
				if (seq === searchSeq.current) setResults(found);
			} catch (reason) {
				if (seq === searchSeq.current) {
					setSearchError(
						reason instanceof Error ? reason.message : String(reason),
					);
				}
			} finally {
				if (seq === searchSeq.current) setSearching(false);
			}
		},
		[searchedTasks],
	);

	useEffect(() => {
		void refreshInstalled();
	}, [refreshInstalled]);

	// Debounced: the Hub API is queried as the user types.
	useEffect(() => {
		const timer = window.setTimeout(() => void search(query), 300);
		return () => window.clearTimeout(timer);
	}, [query, search]);

	const run = async <T>(modelId: string, operation: () => Promise<T>) => {
		setBusy(modelId);
		setPercent(0);
		setError(null);
		try {
			return await operation();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
			return null;
		} finally {
			setBusy(null);
			await refreshInstalled();
		}
	};

	/**
	 * Loads a model and selects it for its category: the result's task says
	 * which, and a pasted repo is described by the service once inspected.
	 * Resolves to that category, or null when it failed.
	 */
	const use = async (
		modelId: string,
		pipelineTask?: MediaPipelineTask,
	): Promise<MediaCategory | null> => {
		const known = allInstalled.find(
			(model) => model.id.toLowerCase() === modelId.toLowerCase(),
		);
		const target =
			(pipelineTask ? TASK_CATEGORY[pipelineTask] : undefined) ??
			(known?.categories?.[0] as MediaCategory | undefined);
		const info = await run(modelId, () =>
			serviceManager.llmService.serveFor(
				LOCAL_MEDIA_SERVICE,
				modelId,
				(progress) => setPercent(Math.round(progress.percent)),
				target ? { category: target } : undefined,
			),
		);
		if (!info) return null;
		return (
			target ?? (info.categories?.[0] as MediaCategory | undefined) ?? category
		);
	};

	const unload = (modelId: string) =>
		run(modelId, () =>
			serviceManager.llmService.unloadFor(LOCAL_MEDIA_SERVICE, modelId),
		);

	const remove = (modelId: string) =>
		run(modelId, async () => {
			const categories = allInstalled.find(
				(model) => model.id.toLowerCase() === modelId.toLowerCase(),
			)?.categories ?? [category];
			await serviceManager.llmService.deleteModelFor(
				LOCAL_MEDIA_SERVICE,
				modelId,
			);
			await removeMediaModel(modelId);
			for (const item of categories) {
				if (item === "chat" || item === "embedding") continue;
				const current =
					await serviceManager.llmService.getCurrentModelFor(item);
				if (current?.modelId.toLowerCase() === modelId.toLowerCase()) {
					await serviceManager.llmService.clearCurrentModelFor(item);
				}
			}
			return true;
		});

	return {
		installed,
		results,
		query,
		setQuery,
		/** The repo id in the search box, when it holds an id or a Hub link. */
		pastedRepoId: repoIdFromInput(query),
		filter,
		setFilter,
		task,
		setTask,
		tasksOfFilter,
		browseUrl: hubBrowseUrl(searchedTasks, repoIdFromInput(query) ? "" : query),
		searching,
		searchError,
		busy,
		percent,
		error,
		use,
		unload,
		remove,
	};
}
