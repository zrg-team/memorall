import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	listLoadableGgufFiles,
	pickProjectorFile,
} from "@/main/modules/llm/utils/gguf-repo-files";
import { serviceManager } from "@/services";
import { DEFAULT_SERVICES } from "@/services/llm/constants";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import {
	type HubGgufModel,
	pickDefaultGgufFile,
	searchHubGgufModels,
} from "@/services/llm/registry/gguf-hub-search";

const SEARCH_DEBOUNCE_MS = 300;

interface RepoTreeEntry {
	type?: string;
	path: string;
	size?: number;
}

export interface GgufDownload {
	file: string;
	/** The model and its projector together. */
	sizeBytes: number;
}

const downloads = new Map<string, Promise<GgufDownload | null>>();

async function fetchGgufDownload(repo: string): Promise<GgufDownload | null> {
	const response = await fetch(
		`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`,
	);
	if (!response.ok) {
		throw new Error(`Could not read ${repo} (${response.status})`);
	}
	const tree = (await response.json()) as RepoTreeEntry[];
	const siblings = tree
		.filter((entry) => entry.type !== "directory")
		.map((entry) => ({ rfilename: entry.path, size: entry.size }));
	const model = pickDefaultGgufFile(listLoadableGgufFiles(siblings));
	if (!model) return null;
	return {
		file: model.name,
		sizeBytes: model.size + (pickProjectorFile(siblings)?.size ?? 0),
	};
}

/** Which file of a repo would be downloaded, and how much that costs. */
export function resolveGgufDownload(
	repo: string,
): Promise<GgufDownload | null> {
	const cached = downloads.get(repo);
	if (cached) return cached;
	const pending = fetchGgufDownload(repo).catch((error) => {
		downloads.delete(repo);
		throw error;
	});
	downloads.set(repo, pending);
	return pending;
}

/**
 * GGUF speech models on the Hub. "Use" loads one without selecting it, because
 * only a loaded model can finally say whether it does this studio's task.
 */
export function useHubGgufModels(category: MediaCategory) {
	const { t } = useTranslation("studio");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<HubGgufModel[]>([]);
	const [searching, setSearching] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [percent, setPercent] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const searchSeq = useRef(0);

	useEffect(() => {
		const seq = ++searchSeq.current;
		setSearching(true);
		const timer = window.setTimeout(() => {
			searchHubGgufModels(category, query, {
				onUpdate: (found) => {
					if (seq === searchSeq.current) setResults(found);
				},
			})
				.then((found) => {
					if (seq === searchSeq.current) setResults(found);
				})
				.catch((reason) => {
					if (seq === searchSeq.current) {
						setError(reason instanceof Error ? reason.message : String(reason));
					}
				})
				.finally(() => {
					if (seq === searchSeq.current) setSearching(false);
				});
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [category, query]);

	/** Resolves to whether the model is now selected for this task. */
	const use = useCallback(
		async (repo: string): Promise<boolean> => {
			setBusy(repo);
			setPercent(0);
			setError(null);
			try {
				const download = await resolveGgufDownload(repo);
				if (!download) {
					setError(
						t("ggufModels.noGgufFile", {
							defaultValue: "This repository has no GGUF model file to load.",
						}),
					);
					return false;
				}
				const modelId = `${repo}/${download.file}`;
				const serviceName = DEFAULT_SERVICES.WLLAMA;
				const info = await serviceManager.llmService.serveFor(
					serviceName,
					modelId,
					(progress) => setPercent(Math.round(progress.percent)),
					// The category keeps this off the app-wide chat download screen,
					// which would unmount this list with its progress and any error.
					{ category, select: false },
				);
				if (!info.categories?.includes(category)) {
					setError(
						t("ggufModels.notSupported", {
							defaultValue:
								"This model loaded, but it cannot do this task. Try another one.",
						}),
					);
					return false;
				}
				await serviceManager.llmService.setCurrentModelFor(
					category,
					"wllama",
					modelId,
					serviceName,
				);
				return true;
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : String(reason));
				return false;
			} finally {
				setBusy(null);
			}
		},
		[category, t],
	);

	return { query, setQuery, results, searching, busy, percent, error, use };
}
