import type { Node } from "../../interfaces/knowledge";
import type { IEmbeddingService } from "../../interfaces/embedding";
import type { ChatCompletionResponse } from "../../interfaces/messages";
import { getCurrentEmbeddingFields } from "../../utils/embedding-size-config";
import { logError, logWarn } from "../../interfaces/logger";
import type {
	StructMemEntry,
	StructMemEntryKind,
} from "../../graph/structmem/state";

export interface StructMemNodeRow {
	id: string;
	node_type?: string;
	name: string;
	summary?: string | null;
	attributes?: Record<string, unknown> | string | null;
	graph?: string;
	created_at?: string;
	updated_at?: string;
	similarity?: number;
}

export function parseJsonObject(text: string): unknown {
	let cleaned = text.trim();
	if (cleaned.startsWith("```json")) {
		cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
	} else if (cleaned.startsWith("```")) {
		cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");
	}

	const firstBrace = cleaned.indexOf("{");
	const lastBrace = cleaned.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		cleaned = cleaned.slice(firstBrace, lastBrace + 1);
	}

	return JSON.parse(cleaned);
}

export function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return typeof parsed === "object" && parsed !== null
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

export function nodeRowToStructMemEntry(row: StructMemNodeRow): StructMemEntry {
	const attributes = asRecord(row.attributes);
	const entryKind =
		attributes.entryKind === "relational" ? "relational" : "factual";
	const timestamp =
		typeof attributes.timestamp === "string"
			? attributes.timestamp
			: row.created_at
				? new Date(row.created_at).toISOString()
				: new Date().toISOString();

	return {
		uuid:
			typeof attributes.entryUuid === "string" ? attributes.entryUuid : row.id,
		eventId:
			typeof attributes.eventId === "string" ? attributes.eventId : row.id,
		entryKind,
		text: row.summary || row.name,
		timestamp,
		sourceId:
			typeof attributes.sourceId === "string" ? attributes.sourceId : undefined,
		title: typeof attributes.title === "string" ? attributes.title : undefined,
		url: typeof attributes.url === "string" ? attributes.url : undefined,
		confidence:
			typeof attributes.confidence === "number"
				? attributes.confidence
				: undefined,
		metadata: attributes,
		nodeId: row.id,
	};
}

export function toNodeLike(row: StructMemNodeRow): Node {
	return {
		id: row.id,
		nodeType: row.node_type ?? "structmem_entry",
		name: row.name,
		summary: row.summary ?? null,
		attributes: asRecord(row.attributes),
		graph: row.graph ?? "",
		createdAt: row.created_at ? new Date(row.created_at) : new Date(),
		updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
		nameEmbeddingSmall: null,
		nameEmbedding: null,
		nameEmbeddingLarge: null,
	};
}

export async function safeTextToVector(
	embeddingService: IEmbeddingService | undefined,
	text: string,
	context: string,
): Promise<number[] | null> {
	try {
		if (!text.trim() || !embeddingService) return null;
		const defaultEmbedding = await embeddingService.get("default");
		if (!defaultEmbedding?.isReady()) return null;
		return await defaultEmbedding.textToVector(text);
	} catch (error) {
		logError(`[${context}] Embedding failed, continuing without vector`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function withEmbeddingField(
	embeddingService: IEmbeddingService | undefined,
	text: string,
	target: Record<string, unknown>,
	context: string,
): Promise<void> {
	const embedding = await safeTextToVector(embeddingService, text, context);
	if (!embedding) return;
	const fields = await getCurrentEmbeddingFields();
	target[fields.nameEmbedding] = embedding;
}

export function createEntry(
	eventId: string,
	entryKind: StructMemEntryKind,
	text: string,
	timestamp: string,
	source: {
		sourceId?: string;
		title?: string;
		url?: string;
		confidence?: number;
		metadata?: Record<string, unknown>;
	},
): StructMemEntry {
	return {
		uuid: crypto.randomUUID(),
		eventId,
		entryKind,
		text: text.trim(),
		timestamp,
		sourceId: source.sourceId,
		title: source.title,
		url: source.url,
		confidence: source.confidence,
		metadata: source.metadata,
	};
}

export function compactEntryLabel(entry: StructMemEntry): string {
	const normalized = entry.text.replace(/\s+/g, " ").trim();
	if (normalized.length <= 72) return normalized;
	return `${normalized.slice(0, 69).trim()}...`;
}

export function getChatResponseText(response: ChatCompletionResponse): string {
	return response.choices[0]?.message?.content || "";
}

export function dedupeEntries(entries: StructMemEntry[]): StructMemEntry[] {
	const seen = new Set<string>();
	const result: StructMemEntry[] = [];
	for (const entry of entries) {
		const key = `${entry.eventId}|${entry.entryKind}|${entry.text.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}
	return result;
}

export function groupEntriesByEvent(entries: StructMemEntry[]) {
	const map = new Map<string, StructMemEntry[]>();
	for (const entry of entries) {
		const list = map.get(entry.eventId) ?? [];
		list.push(entry);
		map.set(entry.eventId, list);
	}
	return map;
}

export function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

export function warnParseFailure(
	context: string,
	content: string,
	error: unknown,
) {
	logWarn(`[${context}] Failed to parse model JSON`, {
		error: error instanceof Error ? error.message : String(error),
		content: content.slice(0, 300),
	});
}
