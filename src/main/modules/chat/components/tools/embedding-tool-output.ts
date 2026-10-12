import type { EmbeddingToolResult } from "@/services/folder-index/embedding/tool-results";

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const json = (value: string): unknown => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

export type EmbeddingDisplayHit = EmbeddingToolResult["hits"][number] & {
	locationLabel?: string;
};
export interface EmbeddingDisplayResult
	extends Omit<EmbeddingToolResult, "hits"> {
	hits: EmbeddingDisplayHit[];
	previewUrls: Map<string, string>;
}

export const parseEmbeddingToolOutput = (
	description: string,
	metadata?: Record<string, unknown>,
): EmbeddingDisplayResult | null => {
	const parsed = json(description);
	const parts = Array.isArray(parsed) ? parsed : [];
	const urls = (
		Array.isArray(metadata?.imageUrls)
			? metadata.imageUrls
			: parts.flatMap((part) =>
					record(part) && part.type === "image_url" && record(part.image_url)
						? [part.image_url.url]
						: [],
				)
	).filter(
		(url): url is string =>
			typeof url === "string" &&
			/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(url),
	);
	const payload = [
		metadata?.structuredContent,
		metadata,
		parsed,
		...parts.flatMap((part) =>
			record(part) && typeof part.text === "string" ? [json(part.text)] : [],
		),
	].find(
		(value) =>
			record(value) &&
			(value.actionType === "embedding_search" ||
				value.actionType === "embedding_chunks") &&
			Array.isArray(value.hits),
	);
	if (record(payload)) {
		const hits = (payload.hits as unknown[]).filter(
			(hit): hit is EmbeddingDisplayHit =>
				record(hit) &&
				typeof hit.path === "string" &&
				typeof hit.id === "string" &&
				["text", "image", "audio", "video"].includes(String(hit.kind)) &&
				record(hit.location),
		);
		const previewPaths = Array.isArray(payload.previewPaths)
			? payload.previewPaths.filter(
					(path): path is string => typeof path === "string",
				)
			: [];
		return {
			actionType: payload.actionType as EmbeddingToolResult["actionType"],
			query: typeof payload.query === "string" ? payload.query : undefined,
			path: typeof payload.path === "string" ? payload.path : undefined,
			total: typeof payload.total === "number" ? payload.total : undefined,
			offset: typeof payload.offset === "number" ? payload.offset : undefined,
			matched:
				typeof payload.matched === "number" ? payload.matched : hits.length,
			searched: typeof payload.searched === "number" ? payload.searched : 0,
			truncated: payload.truncated === true,
			hits,
			previewPaths,
			nextSteps: [],
			previewUrls: new Map(
				previewPaths.flatMap((path, i) =>
					urls[i] ? [[path, urls[i]] as [string, string]] : [],
				),
			),
		};
	}
	// Existing chats used prose results. Keep them readable without rewriting history.
	const summary = description.match(/(\d+) matches from (\d+) chunks/);
	if (!summary) return null;
	const matches = [
		...description.matchAll(
			/^(\/[^\r\n]+)\r?\n\s*(text|image|audio|video) · (.*?) · cosine (-?\d+(?:\.\d+)?)\r?\n\s*Chunk: ([^\r\n]+)/gm,
		),
	];
	const hits: EmbeddingDisplayHit[] = matches.map((match, i) => ({
		path: match[1],
		title: match[1].split("/").at(-1) ?? match[1],
		kind: match[2] as EmbeddingDisplayHit["kind"],
		location: {},
		locationLabel: match[3],
		score: Number(match[4]),
		id: match[5],
		text:
			description
				.slice(
					match.index! + match[0].length,
					matches[i + 1]?.index ?? description.length,
				)
				.trim()
				.slice(0, 600) || undefined,
	}));
	return {
		actionType: "embedding_search",
		matched: Number(summary[1]),
		searched: Number(summary[2]),
		truncated: description.includes("search limit reached"),
		hits,
		nextSteps: [],
		previewPaths: [],
		previewUrls: new Map(),
	};
};
