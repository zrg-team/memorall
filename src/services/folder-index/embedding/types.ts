import type { MultimodalEmbeddingInput } from "@/services/embedding/interfaces/multimodal-embedding";

export type ChunkKind = MultimodalEmbeddingInput["kind"];
export interface ChunkLocation {
	page?: number;
	sheet?: string;
	startChar?: number;
	endChar?: number;
	startSeconds?: number;
	endSeconds?: number;
}
export interface EmbeddingChunk {
	id: string;
	path: string;
	title: string;
	kind: ChunkKind;
	location: ChunkLocation;
	text?: string;
	vector: number[];
}
export interface PreparedChunk {
	kind: ChunkKind;
	location: ChunkLocation;
	text?: string;
	input: MultimodalEmbeddingInput;
}
export interface EmbeddingSearchInput {
	query: string;
	folder?: string;
	kind?: ChunkKind;
	limit?: number;
}
export type EmbeddingSearchHit = Omit<EmbeddingChunk, "vector"> & {
	score: number;
};
export interface EmbeddingSearchResult {
	hits: EmbeddingSearchHit[];
	searched: number;
	truncated: boolean;
}

export const chunkLocationLabel = (location: ChunkLocation): string => {
	if (location.startSeconds !== undefined) {
		const time = (seconds: number) => {
			const value = Math.floor(seconds);
			return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
		};
		return `${time(location.startSeconds)}–${time(location.endSeconds ?? location.startSeconds)}`;
	}
	return (
		[
			location.page ? `Page ${location.page}` : "",
			location.sheet ?? "",
			location.startChar !== undefined
				? `Characters ${location.startChar + 1}–${location.endChar}`
				: "",
		]
			.filter(Boolean)
			.join(" · ") || "Whole image"
	);
};
