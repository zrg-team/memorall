import type {
	MediaCategory,
	ModelCategory,
} from "../interfaces/model-category";

const HUB_ORIGIN = "https://huggingface.co";
const HUB_API = `${HUB_ORIGIN}/api/models`;
const RESULT_LIMIT = 20;
/** Tags only hint at speech, so each is read deep enough to find the real ones. */
const CANDIDATES_PER_TAG = 40;
const PROBE_CONCURRENCY = 8;
/** A projector's flags sit in its first few KB, ahead of any tensors. */
const PROJECTOR_HEADER_BYTES = 32 * 1024;
const GGUF_BOOL_TYPE = 7;
const AUDIO_ENCODER_KEY = "clip.has_audio_encoder";
const AUDIO_GENERATOR_KEY = "clip.has_gen_audio_encoder";

/** Hub pipeline tags that GGUF speech models are published under. */
const SPEECH_PIPELINE_TAGS = [
	"any-to-any",
	"automatic-speech-recognition",
	"audio-text-to-text",
	"text-to-speech",
] as const;

interface RepoAudioAbilities {
	hearsAudio: boolean;
	generatesAudio: boolean;
	hasChatTemplate: boolean;
}

/**
 * What each studio needs from a repo, read from the files themselves. Tags
 * cannot answer this: most "any-to-any" GGUFs take audio in but cannot speak.
 */
const SPEECH_REQUIREMENTS: Partial<
	Record<ModelCategory, (repo: RepoAudioAbilities) => boolean>
> = {
	"text-to-speech": (repo) => repo.generatesAudio,
	// A speech generator with no chat template only hears a voice to imitate.
	"speech-to-text": (repo) =>
		repo.hearsAudio && (repo.hasChatTemplate || !repo.generatesAudio),
	"speech-to-speech": (repo) =>
		repo.hearsAudio && repo.generatesAudio && repo.hasChatTemplate,
};

export interface HubGgufModel {
	id: string;
	downloads: number;
	likes: number;
}

interface HubModelResponse {
	id: string;
	downloads?: number;
	likes?: number;
	siblings?: { rfilename: string }[];
	gguf?: { chat_template?: string };
}

type ProjectorAudio = Pick<RepoAudioAbilities, "hearsAudio" | "generatesAudio">;

export const supportsGgufSpeechSearch = (
	category: ModelCategory,
): category is MediaCategory => category in SPEECH_REQUIREMENTS;

const projectorFileOf = (model: HubModelResponse): string | undefined =>
	model.siblings
		?.map((sibling) => sibling.rfilename)
		.find((name) => {
			const lower = name.toLowerCase();
			return lower.endsWith(".gguf") && lower.includes("mmproj");
		});

function readBoolFlag(header: Uint8Array, key: string): boolean {
	// One byte per character, so a text offset is also a byte offset.
	const at = new TextDecoder("latin1").decode(header).indexOf(key);
	if (at < 0) return false;
	const valueAt = at + key.length;
	if (valueAt + 5 > header.byteLength) return false;
	const view = new DataView(
		header.buffer,
		header.byteOffset,
		header.byteLength,
	);
	return (
		view.getUint32(valueAt, true) === GGUF_BOOL_TYPE &&
		view.getUint8(valueAt + 4) !== 0
	);
}

const projectorCache = new Map<string, Promise<ProjectorAudio | null>>();

function readProjectorAudio(
	repo: string,
	file: string,
	fetcher: typeof fetch,
): Promise<ProjectorAudio | null> {
	const cached = projectorCache.get(repo);
	if (cached) return cached;
	const pending = (async () => {
		const response = await fetcher(
			`${HUB_ORIGIN}/${repo}/resolve/main/${file}`,
			{
				headers: { Range: `bytes=0-${PROJECTOR_HEADER_BYTES - 1}` },
			},
		);
		if (!response.ok) return null;
		const header = new Uint8Array(await response.arrayBuffer());
		return {
			hearsAudio: readBoolFlag(header, AUDIO_ENCODER_KEY),
			generatesAudio: readBoolFlag(header, AUDIO_GENERATOR_KEY),
		};
	})().catch((error) => {
		// A network failure says nothing about the repo; ask again next time.
		projectorCache.delete(repo);
		throw error;
	});
	projectorCache.set(repo, pending);
	return pending;
}

async function listCandidates(
	query: string,
	fetcher: typeof fetch,
): Promise<HubModelResponse[]> {
	const lists = await Promise.all(
		SPEECH_PIPELINE_TAGS.map(async (tag) => {
			const params = new URLSearchParams({
				filter: "gguf",
				pipeline_tag: tag,
				sort: "downloads",
				limit: String(CANDIDATES_PER_TAG),
			});
			if (query.trim()) params.set("search", query.trim());
			for (const field of ["downloads", "likes", "siblings", "gguf"]) {
				params.append("expand[]", field);
			}
			const response = await fetcher(`${HUB_API}?${params}`);
			if (!response.ok) return [];
			return (await response.json()) as HubModelResponse[];
		}),
	);
	const candidates = new Map<string, HubModelResponse>();
	for (const model of lists.flat()) {
		if (!candidates.has(model.id)) candidates.set(model.id, model);
	}
	return [...candidates.values()].sort(
		(left, right) => (right.downloads ?? 0) - (left.downloads ?? 0),
	);
}

/**
 * GGUF repos that can do a speech studio's task, most downloaded first. Each
 * candidate's projector header is read first, so nothing is suggested that
 * could only fail after a multi-gigabyte download.
 */
export async function searchHubGgufModels(
	category: ModelCategory,
	query = "",
	options: {
		fetch?: typeof fetch;
		limit?: number;
		/** The matches so far, as each candidate is checked. */
		onUpdate?: (models: HubGgufModel[]) => void;
	} = {},
): Promise<HubGgufModel[]> {
	const requirement = SPEECH_REQUIREMENTS[category];
	if (!requirement) return [];
	const fetcher = options.fetch ?? fetch;
	const limit = options.limit ?? RESULT_LIMIT;
	const queue = await listCandidates(query, fetcher);
	const matches: HubGgufModel[] = [];
	const currentMatches = () =>
		[...matches]
			.sort((left, right) => right.downloads - left.downloads)
			.slice(0, limit);

	await Promise.all(
		Array.from({ length: PROBE_CONCURRENCY }, async () => {
			for (let model = queue.shift(); model; model = queue.shift()) {
				const file = projectorFileOf(model);
				if (!file) continue;
				const audio = await readProjectorAudio(model.id, file, fetcher).catch(
					() => null,
				);
				if (
					!audio ||
					!requirement({
						...audio,
						hasChatTemplate: Boolean(model.gguf?.chat_template),
					})
				) {
					continue;
				}
				matches.push({
					id: model.id,
					downloads: model.downloads ?? 0,
					likes: model.likes ?? 0,
				});
				options.onUpdate?.(currentMatches());
			}
		}),
	);
	return currentMatches();
}

/**
 * The file to load from a repo's loadable GGUF files: the usual 4-bit
 * quantization, then any 4-bit one, then 8-bit, since a browser has the memory
 * of one tab. Files are expected smallest first.
 */
export function pickDefaultGgufFile<T extends { name: string }>(
	files: readonly T[],
): T | undefined {
	for (const quantization of ["q4_k_m", "q4", "q8_0"]) {
		const match = files.find((file) =>
			file.name.toLowerCase().includes(quantization),
		);
		if (match) return match;
	}
	return files[0];
}

export const __testing = {
	clearProjectorCache: () => projectorCache.clear(),
};
