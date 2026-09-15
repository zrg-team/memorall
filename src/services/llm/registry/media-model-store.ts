import { eq, like } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { MediaVoice } from "@/types/openai-media";
import type { DeviceDownloadSizes } from "../interfaces/base-llm";
import type {
	MediaModelConfig,
	MediaPipelineTask,
} from "../interfaces/media-model-config";
import type { MediaCategory } from "../interfaces/model-category";
import {
	CATEGORY_TASKS,
	TASK_CATEGORY,
	isMediaPipelineTask,
} from "./media-model-registry";
import {
	PIPELINE_ARCHITECTURES,
	PIPELINE_TASK_ALIASES,
} from "./pipeline-architectures.generated";

/**
 * One configurations row per added model, keyed by this prefix and the
 * lower-cased repo id. A row per model (rather than one list row) means the UI
 * and the offscreen host can add or remove different models concurrently
 * without overwriting each other.
 */
export const MEDIA_MODEL_KEY_PREFIX = "_MEDIA_MODEL_:";

const HUB_API = "https://huggingface.co/api/models";

const keyFor = (modelId: string) =>
	`${MEDIA_MODEL_KEY_PREFIX}${modelId.trim().toLowerCase()}`;

const asConfig = (data: unknown): MediaModelConfig | undefined => {
	const model = data as MediaModelConfig | undefined;
	return typeof model?.id === "string" && isMediaPipelineTask(model?.task)
		? model
		: undefined;
};

/**
 * Models added to the media studios, persisted in the configurations table so
 * the UI and the offscreen runner host read the same list.
 */
export async function listMediaModels(): Promise<MediaModelConfig[]> {
	const rows = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select()
			.from(schema.configurations)
			.where(like(schema.configurations.key, `${MEDIA_MODEL_KEY_PREFIX}%`)),
	);
	return rows
		.map((row) => asConfig(row.data))
		.filter((model): model is MediaModelConfig => model !== undefined)
		.sort((left, right) => left.addedAt.localeCompare(right.addedAt));
}

export async function getMediaModel(
	modelId: string,
): Promise<MediaModelConfig | undefined> {
	const rows = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select()
			.from(schema.configurations)
			.where(eq(schema.configurations.key, keyFor(modelId)))
			.limit(1),
	);
	return asConfig(rows[0]?.data);
}

export async function saveMediaModel(config: MediaModelConfig): Promise<void> {
	const key = keyFor(config.id);
	const data = config as unknown as Record<string, unknown>;
	await serviceManager.databaseService.use(async ({ db, schema }) => {
		// Update first: the stored table has no unique constraint on `key` to
		// upsert against, and a per-model row keeps any race to the same model.
		const updated = await db
			.update(schema.configurations)
			.set({ data, updatedAt: new Date() })
			.where(eq(schema.configurations.key, key))
			.returning({ key: schema.configurations.key });
		if (updated.length === 0) {
			await db
				.insert(schema.configurations)
				.values({ key, data, createdAt: new Date(), updatedAt: new Date() });
		}
	});
}

export async function removeMediaModel(modelId: string): Promise<void> {
	await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.delete(schema.configurations)
			.where(eq(schema.configurations.key, keyFor(modelId))),
	);
}

interface HubSibling {
	rfilename: string;
	size?: number;
}

interface HubModel {
	id: string;
	pipeline_tag?: string;
	library_name?: string;
	tags?: string[];
	downloads?: number;
	likes?: number;
	cardData?: { language?: string | string[]; license?: string };
	siblings?: HubSibling[];
	/** The parts of config.json the Hub indexes (`model_type`, …). */
	config?: { model_type?: string };
}

/** Why a Hub repo cannot run in the browser studios. */
export type HubUnavailableReason =
	| "no-onnx"
	| "custom-runtime"
	| "unsupported-architecture";

export interface HubModelSummary {
	id: string;
	task: MediaPipelineTask;
	downloads: number;
	likes: number;
	languages: string[];
	/** False for a match the in-browser pipeline cannot load; see `reason`. */
	runnable: boolean;
	reason?: HubUnavailableReason;
	/** The repo's architecture, when it is the reason. */
	modelType?: string;
}

const toArray = (value: string | string[] | undefined): string[] =>
	Array.isArray(value) ? value : value ? [value] : [];

/**
 * Speaker embeddings a repo ships, offered as voices. Found by file shape -
 * binary embeddings in a `voices`/`speaker` folder or named as embeddings -
 * so any model that follows the convention gets a voice picker.
 */
export function discoverVoices(
	repoId: string,
	siblings: HubSibling[] = [],
): MediaVoice[] {
	return siblings
		.map((sibling) => sibling.rfilename)
		.filter(
			(path) =>
				/\.bin$/i.test(path) &&
				/(^|\/)(voices?|speakers?|speaker_embeddings?)(\/|$)|speaker|embedding/i.test(
					path,
				),
		)
		.sort()
		.map((path) => ({
			id: path,
			name:
				path
					.split("/")
					.pop()
					?.replace(/\.bin$/i, "") ?? path,
			previewUrl: undefined,
			path: `https://huggingface.co/${repoId}/resolve/main/${path}`,
		}));
}

/** Weight formats transformers.js never downloads. */
const NON_BROWSER_WEIGHTS =
	/\.(safetensors|pt|pth|ckpt|h5|msgpack|tflite|gguf|mlmodel)$|(^|\/)(pytorch_model|tf_model|flax_model)[^/]*$/i;

/**
 * File suffix of each ONNX precision transformers.js loads, as it names them:
 * `<graph><suffix>.onnx` (plus `.onnx_data*` for external weights).
 */
const PRECISION_SUFFIX = {
	fp32: "",
	fp16: "_fp16",
	q8: "_quantized",
	int8: "_int8",
	uint8: "_uint8",
	q4: "_q4",
	q4f16: "_q4f16",
	bnb4: "_bnb4",
} as const;

export type DownloadPrecision = keyof typeof PRECISION_SUFFIX;

const VARIANT_SUFFIXES = Object.values(PRECISION_SUFFIX).filter(Boolean);

/** `onnx/model_q4.onnx_data_1` -> { graph: "onnx/model", suffix: "_q4" } */
function parseOnnxFile(name: string): { graph: string; suffix: string } | null {
	const match = /^(.*)\.onnx(?:_data(?:_\d+)?)?$/i.exec(name);
	if (!match) return null;
	const stem = match[1];
	const suffix = VARIANT_SUFFIXES.find((candidate) =>
		stem.toLowerCase().endsWith(candidate),
	);
	return suffix
		? { graph: stem.slice(0, -suffix.length), suffix }
		: { graph: stem, suffix: "" };
}

/**
 * Approximate bytes one load downloads in `precision`: the repo's config and
 * processor files plus one copy of each ONNX graph a loader uses, in that
 * precision, falling back to the full-precision copy of a graph that has none. Repos publish every
 * graph in several precisions and other frameworks' weights too, so summing the
 * whole repo overstates it several times over.
 */
export function estimateDownloadBytes(
	siblings: HubSibling[] = [],
	precision: DownloadPrecision = "fp32",
): number {
	const parsed = siblings.map((sibling) => parseOnnxFile(sibling.rfilename));
	// Optimum's export convention: a `<name>_model_merged` graph (one decoder
	// with and without past key values) replaces `<name>_model` and
	// `<name>_with_past_model`, and loaders only fetch the merged one.
	const superseded = new Set(
		parsed.flatMap((file) => {
			const prefix = file && /^(.*)_model_merged$/.exec(file.graph)?.[1];
			return prefix ? [`${prefix}_model`, `${prefix}_with_past_model`] : [];
		}),
	);
	const files = siblings.filter((sibling) => {
		if (NON_BROWSER_WEIGHTS.test(sibling.rfilename)) return false;
		const file = parseOnnxFile(sibling.rfilename);
		return !(file && superseded.has(file.graph));
	});
	const wanted = PRECISION_SUFFIX[precision];
	const graphsWithWanted = new Set(
		files
			.map((sibling) => parseOnnxFile(sibling.rfilename))
			.filter((file) => file?.suffix === wanted)
			.map((file) => file?.graph),
	);
	return files
		.filter((sibling) => {
			const file = parseOnnxFile(sibling.rfilename);
			if (!file) return true;
			if (file.suffix === wanted) return true;
			return file.suffix === "" && !graphsWithWanted.has(file.graph);
		})
		.reduce((total, sibling) => total + (sibling.size ?? 0), 0);
}

/** A repo's download estimates, for the device default and across precisions. */
export interface HubDownloadEstimate {
	/** transformers.js defaults: fp32 on WebGPU, q8 on WASM. */
	byDevice: DeviceDownloadSizes;
	/** Smallest and largest precision the repo ships, for runtimes that choose. */
	smallest?: number;
	largest?: number;
}

/** Download estimates for both devices, from a repo's file listing. */
export function estimateDeviceDownloads(
	siblings: HubSibling[] = [],
): DeviceDownloadSizes {
	return {
		webgpu: estimateDownloadBytes(siblings, "fp32") || undefined,
		wasm: estimateDownloadBytes(siblings, "q8") || undefined,
	};
}

export function estimateHubDownload(
	siblings: HubSibling[] = [],
): HubDownloadEstimate {
	const sizes = (Object.keys(PRECISION_SUFFIX) as DownloadPrecision[])
		.map((precision) => estimateDownloadBytes(siblings, precision))
		.filter((bytes) => bytes > 0);
	return {
		byDevice: estimateDeviceDownloads(siblings),
		smallest: sizes.length ? Math.min(...sizes) : undefined,
		largest: sizes.length ? Math.max(...sizes) : undefined,
	};
}

const hubSizeCache = new Map<string, Promise<HubDownloadEstimate | null>>();
const HUB_SIZE_CONCURRENCY = 4;
let hubSizeActive = 0;
const hubSizeWaiting: (() => void)[] = [];

/** Runs `task` once fewer than `HUB_SIZE_CONCURRENCY` lookups are in flight. */
async function withHubSizeSlot<T>(task: () => Promise<T>): Promise<T> {
	if (hubSizeActive >= HUB_SIZE_CONCURRENCY) {
		await new Promise<void>((resolve) => hubSizeWaiting.push(resolve));
	}
	hubSizeActive++;
	try {
		return await task();
	} finally {
		hubSizeActive--;
		hubSizeWaiting.shift()?.();
	}
}

/**
 * Download estimates for any Hub repo, fetched once per repo per session. Hub
 * search results carry no file sizes, so a list asks for each row it shows.
 */
export function fetchHubDownloadSizes(
	repoId: string,
	options: { fetch?: typeof fetch } = {},
): Promise<HubDownloadEstimate | null> {
	const key = repoId.trim().toLowerCase();
	const cached = hubSizeCache.get(key);
	if (cached) return cached;
	const fetcher = options.fetch ?? fetch;
	const pending = withHubSizeSlot(() =>
		fetcher(`${HUB_API}/${repoId.trim()}?blobs=true`),
	)
		.then(async (response) => {
			if (!response.ok) return null;
			const model = (await response.json()) as HubModel;
			return estimateHubDownload(model.siblings);
		})
		.catch(() => {
			// A network blip should not stick for the whole session.
			hubSizeCache.delete(key);
			return null;
		});
	hubSizeCache.set(key, pending);
	return pending;
}

/** The transformers.js pipeline task that loads a studio task's models. */
export function pipelineTaskOf(task: MediaPipelineTask): string {
	// Rerankers are sequence classifiers: the text-classification pipeline
	// loads them (see the runner's loaders.js).
	const base = task === "text-ranking" ? "text-classification" : task;
	return PIPELINE_TASK_ALIASES[base] ?? base;
}

export type BrowserRunnability =
	| { runnable: true }
	| {
			runnable: false;
			reason: HubUnavailableReason;
			/** The repo's `model_type`, for an unsupported architecture. */
			modelType?: string;
	  };

/**
 * Whether the browser runtime can load a repo for `task`, from what the Hub
 * says about it - checked before anything is downloaded.
 *
 * It needs ONNX weights and a `model_type` in config.json (transformers.js
 * picks the architecture from it; ONNX graphs without one come with their own
 * inference code). With a task, the architecture must also be one that task's
 * pipeline can load, as read from the installed library
 * (pipeline-architectures.generated.ts). Hub tags are not trusted for this:
 * repos tagged for transformers.js can still need their own runtime.
 */
export function browserRunnability(
	model: Pick<HubModel, "library_name" | "tags" | "siblings" | "config">,
	task?: MediaPipelineTask,
): BrowserRunnability {
	const hasOnnx = (model.siblings ?? []).some((sibling) =>
		/\.onnx$/i.test(sibling.rfilename),
	);
	if (model.siblings && !hasOnnx) return { runnable: false, reason: "no-onnx" };
	const modelType = model.config?.model_type;
	if (!modelType) {
		// Without a file listing there is nothing to go on but the tag.
		const tagged =
			model.library_name === "transformers.js" ||
			(model.tags ?? []).includes("transformers.js");
		return !model.siblings && tagged
			? { runnable: true }
			: { runnable: false, reason: "custom-runtime" };
	}
	if (task) {
		const spec = PIPELINE_ARCHITECTURES[pipelineTaskOf(task)];
		if (spec && !spec.open && !spec.architectures.includes(modelType)) {
			return { runnable: false, reason: "unsupported-architecture", modelType };
		}
	}
	return { runnable: true };
}

export const isBrowserRunnable = (
	model: Pick<HubModel, "library_name" | "tags" | "siblings" | "config">,
	task?: MediaPipelineTask,
): boolean => browserRunnability(model, task).runnable;

/** Why a repo cannot run, in words, for errors and the model list. */
export function unavailableReasonText(
	repoId: string,
	runnability: Exclude<BrowserRunnability, { runnable: true }>,
	task?: MediaPipelineTask,
): string {
	switch (runnability.reason) {
		case "no-onnx":
			return `${repoId} has no ONNX weights, so it cannot run in the browser.`;
		case "unsupported-architecture":
			return `${repoId} is a "${runnability.modelType}" model, an architecture the in-browser runtime cannot run${task ? ` for ${task}` : ""} yet. Pick another model, or serve this one behind an OpenAI-compatible API to use it here.`;
		default:
			return `${repoId} needs its own runtime (its config.json names no model type the browser runtime knows), so it cannot run in the browser studio. Serve it behind an OpenAI-compatible API to use it here.`;
	}
}

/**
 * Build a studio config for any Hub repo from its own metadata.
 * Throws when the repo is not a browser-runnable media model.
 */
export async function inspectHubModel(
	repoId: string,
	options: { fetch?: typeof fetch; task?: MediaPipelineTask } = {},
): Promise<MediaModelConfig> {
	const fetcher = options.fetch ?? fetch;
	const id = repoIdFromInput(repoId) ?? repoId.trim();
	const response = await fetcher(`${HUB_API}/${id}?blobs=true`);
	if (!response.ok) {
		throw new Error(`Hugging Face has no model "${id}" (${response.status})`);
	}
	const model = (await response.json()) as HubModel;
	const task = options.task ?? model.pipeline_tag;
	if (!isMediaPipelineTask(task)) {
		throw new Error(
			`${model.id} is a "${model.pipeline_tag ?? "unknown"}" model; the studios run ${Object.keys(TASK_CATEGORY).join(", ")}`,
		);
	}
	const runnability = browserRunnability(model, task);
	if (!runnability.runnable) {
		throw new Error(unavailableReasonText(model.id, runnability, task));
	}
	const sizeByDevice = estimateDeviceDownloads(model.siblings);
	const voices = discoverVoices(model.id, model.siblings);
	return {
		id: model.id,
		provider: "transformer-media",
		task,
		category: TASK_CATEGORY[task],
		displayName: model.id.split("/").pop() ?? model.id,
		sizeBytes: sizeByDevice.webgpu,
		sizeByDevice,
		languages: toArray(model.cardData?.language),
		license: model.cardData?.license,
		voices: voices.length > 0 ? voices : undefined,
		addedAt: new Date().toISOString(),
	};
}

/**
 * A Hub repo id from what someone pasted: an id (`org/name`) or any model URL
 * (`https://huggingface.co/org/name/tree/main/onnx`). Null for plain text.
 */
export function repoIdFromInput(input: string): string | null {
	const text = input.trim();
	const fromUrl =
		/^(?:https?:\/\/)?(?:www\.)?(?:hf\.co|huggingface\.co)\/([\w.-]+\/[\w.-]+)(?:[/?#].*)?$/i.exec(
			text,
		);
	if (fromUrl) return fromUrl[1] ?? null;
	return /^[\w.-]+\/[\w.-]+$/.test(text) ? text : null;
}

/**
 * Whether a search names this repo itself: its id (`org/name`, or a link) or
 * its name without the owner.
 */
export function isSpecificMatch(repoId: string, query: string): boolean {
	const text = (repoIdFromInput(query) ?? query).trim().toLowerCase();
	if (!text) return false;
	const id = repoId.toLowerCase();
	return id === text || id.split("/").pop() === text;
}

/**
 * The Hub's own model search for the same tasks and text, for everything this
 * app's search cannot show (other sorts, filters, model cards).
 */
export function hubBrowseUrl(
	tasks: readonly MediaPipelineTask[],
	query = "",
): string {
	const params = new URLSearchParams({
		library: "transformers.js",
		sort: "downloads",
	});
	if (tasks.length === 1 && tasks[0]) params.set("pipeline_tag", tasks[0]);
	if (query.trim()) params.set("search", query.trim());
	return `https://huggingface.co/models?${params}`;
}

const languagesFromTags = (tags: string[] = []) =>
	tags.filter((tag) => /^[a-z]{2,3}$/.test(tag));

/**
 * Hub models for a studio, most downloaded first.
 *
 * The list is models tagged for transformers.js. A search by name also
 * matches the task's other repos, so a model someone is looking for is found
 * even when the browser cannot run it - marked with the reason instead of
 * silently missing.
 */
export async function searchHubModels(
	category: MediaCategory | null,
	query = "",
	options: {
		fetch?: typeof fetch;
		limit?: number;
		/** Search these pipeline tasks instead of the category's. */
		tasks?: readonly MediaPipelineTask[];
	} = {},
): Promise<HubModelSummary[]> {
	const fetcher = options.fetch ?? fetch;
	const tasks =
		options.tasks ?? (category ? (CATEGORY_TASKS[category] ?? []) : []);
	const limit = options.limit ?? 20;
	const text = repoIdFromInput(query) ?? query.trim();

	const request = async (
		task: MediaPipelineTask,
		browserOnly: boolean,
	): Promise<HubModelSummary[]> => {
		const params = new URLSearchParams({
			pipeline_tag: task,
			sort: "downloads",
			limit: String(limit),
		});
		if (browserOnly) params.set("filter", "transformers.js");
		if (text) params.set("search", text);
		// Architecture and files for every result: a transformers.js tag alone
		// does not mean the runtime can load the repo.
		for (const field of [
			"downloads",
			"likes",
			"tags",
			"library_name",
			"config",
			"siblings",
		]) {
			params.append("expand[]", field);
		}
		const response = await fetcher(`${HUB_API}?${params}`);
		if (!response.ok) return [];
		const models = (await response.json()) as HubModel[];
		return models.map((model) => {
			const runnability = browserRunnability(model, task);
			return {
				id: model.id,
				task,
				downloads: model.downloads ?? 0,
				likes: model.likes ?? 0,
				languages: languagesFromTags(model.tags),
				runnable: runnability.runnable,
				...(runnability.runnable
					? {}
					: { reason: runnability.reason, modelType: runnability.modelType }),
			};
		});
	};

	const results = await Promise.all(
		tasks.flatMap((task) =>
			text
				? [request(task, true), request(task, false)]
				: [request(task, true)],
		),
	);
	const byId = new Map<string, HubModelSummary>();
	for (const result of results.flat()) {
		const key = result.id.toLowerCase();
		const known = byId.get(key);
		if (!known || (!known.runnable && result.runnable)) byId.set(key, result);
	}
	// Lists only offer what the browser runtime can run. A model the user asked
	// for by name is the exception: it stays, marked with why it cannot run,
	// rather than looking like it does not exist.
	return Array.from(byId.values())
		.filter((result) => result.runnable || isSpecificMatch(result.id, text))
		.sort(
			(left, right) =>
				Number(right.runnable) - Number(left.runnable) ||
				right.downloads - left.downloads,
		)
		.slice(0, limit);
}
