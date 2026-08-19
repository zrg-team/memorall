import type {
	Tool,
	ToolExecutionContext,
	ToolExecutionResult,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { buildThreadHistorySearchVectorSql } from "@/services/database/thread-history-search-vector";

export const THREAD_HISTORY_SEARCH_TOOL = "thread_history_search" as const;
export const THREAD_HISTORY_READ_TOOL = "thread_history_read" as const;
export const THREAD_HISTORY_CONVERSATION_RUNTIME_KEY =
	"thread.history.conversationId";
export const THREAD_HISTORY_SEPARATOR_RUNTIME_KEY =
	"thread.history.separatorId";

const SEARCH_RESPONSE_BUDGET = 12_000;
const READ_RESPONSE_BUDGET = 24_000;
const MAX_READ_LINES = 200;
/** Rows pulled per search before ranking; the ranker needs slack to work with. */
const MAX_SEARCH_CANDIDATES = 200;
/** Query terms kept for scoring — bounds the width of the corpus-stats SQL. */
const MAX_SEARCH_TERMS = 8;

/**
 * BM25 constants. Messages carry no embeddings — the three vector columns on
 * the table are never written for chat rows — so recall here is purely lexical
 * (tsvector OR ILIKE) and ranking has to come from term statistics rather than
 * similarity.
 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
/** Weight of an exact-phrase hit, as a fraction of the query's total IDF. */
export const PHRASE_MATCH_WEIGHT = 0.5;

type Services = Pick<AllServices, "database">;

/**
 * How much of a message to render.
 *
 * A single stored message can hold a whole exchange — assistant tool calls plus
 * their results — so the full text is often far larger than the conversation it
 * belongs to. `compact` keeps the prose and reduces every tool call and result
 * to one line; `detail` renders arguments and outputs in full.
 */
export type ThreadHistoryTextMode = "compact" | "detail";

interface HistoryRow {
	messageId: string;
	role: string;
	content: string;
	parts: unknown;
	complexContent: unknown;
	metadata: unknown;
	createdAt: string | Date;
}

interface HistoryScope {
	conversationId: string;
	separatorId: string;
}

interface CollectContext {
	mode: ThreadHistoryTextMode;
	/** tool_call_id → function name, so a tool result can name its caller. */
	toolNames: Map<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const safeJsonParse = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

const isBinaryText = (value: string): boolean =>
	/^data:[^,]+;base64,/i.test(value.trim()) ||
	(value.length > 512 && /^[A-Za-z0-9+/=\r\n]+$/.test(value));

const toInlineJson = (value: unknown): string => {
	if (typeof value === "string") return value.replace(/\s+/gu, " ").trim();
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

const collectToolCalls = (
	value: unknown,
	output: string[],
	context: CollectContext,
): void => {
	if (!Array.isArray(value)) return;
	for (const call of value) {
		if (!isRecord(call)) continue;
		const fn = isRecord(call.function) ? call.function : call;
		const name = typeof fn.name === "string" ? fn.name : "tool";
		if (typeof call.id === "string" && call.id) {
			context.toolNames.set(call.id, name);
		}
		if (context.mode === "detail") {
			const args = toInlineJson(safeJsonParse(fn.arguments));
			output.push(
				args ? `[tool_call: ${name}] ${args}` : `[tool_call: ${name}]`,
			);
		} else {
			output.push(`[tool_call: ${name}]`);
		}
	}
};

const collectToolResult = (
	parsed: Record<string, unknown>,
	output: string[],
	context: CollectContext,
): void => {
	const callId =
		typeof parsed.tool_call_id === "string" ? parsed.tool_call_id : "";
	const name = context.toolNames.get(callId) ?? "tool";
	const body: string[] = [];
	collectVisibleText(parsed.content, body, context);
	const text = body.join("\n");

	if (context.mode === "detail") {
		output.push(`[tool_result: ${name}]`);
		if (text) output.push(text);
		return;
	}
	output.push(`[tool_result: ${name} · ${text.length} chars]`);
};

const collectVisibleText = (
	value: unknown,
	output: string[],
	context: CollectContext,
): void => {
	const parsed = safeJsonParse(value);
	if (typeof parsed === "string") {
		if (!isBinaryText(parsed) && parsed.trim()) output.push(parsed.trim());
		return;
	}
	if (Array.isArray(parsed)) {
		for (const item of parsed) collectVisibleText(item, output, context);
		return;
	}
	if (!isRecord(parsed)) return;

	const type = typeof parsed.type === "string" ? parsed.type : "";
	if (type === "image_url" || type === "input_image" || type === "image") {
		const image = isRecord(parsed.image_url) ? parsed.image_url : parsed;
		const url = typeof image.url === "string" ? image.url : "";
		if (url && !url.startsWith("data:")) {
			const name = url.split(/[\\/]/).pop();
			if (name) output.push(`Attachment: ${name}`);
		}
		return;
	}

	if (parsed.role === "tool") {
		collectToolResult(parsed, output, context);
		return;
	}

	if (typeof parsed.role === "string" && "content" in parsed) {
		const roleOutput: string[] = [];
		collectVisibleText(parsed.content, roleOutput, context);
		collectToolCalls(parsed.tool_calls, roleOutput, context);
		if (roleOutput.length > 0) {
			output.push(`[${parsed.role}]`);
			output.push(...roleOutput);
		}
		return;
	}

	if (Array.isArray(parsed.tool_calls)) {
		collectToolCalls(parsed.tool_calls, output, context);
		return;
	}

	if (typeof parsed.text === "string") {
		collectVisibleText(parsed.text, output, context);
		return;
	}

	if (typeof parsed.content === "string") {
		collectVisibleText(parsed.content, output, context);
	}
};

const collectAttachmentNames = (metadata: unknown, output: string[]): void => {
	const parsed = safeJsonParse(metadata);
	if (!isRecord(parsed) || !Array.isArray(parsed.attachedDocuments)) return;
	for (const attachment of parsed.attachedDocuments) {
		if (!isRecord(attachment)) continue;
		const name =
			typeof attachment.name === "string"
				? attachment.name
				: typeof attachment.path === "string"
					? attachment.path.split(/[\\/]/).pop()
					: undefined;
		if (name) output.push(`Attachment: ${name}`);
	}
};

export const normalizeThreadHistoryMessage = (
	row: HistoryRow,
	mode: ThreadHistoryTextMode = "compact",
): string => {
	const output: string[] = [];
	const context: CollectContext = { mode, toolNames: new Map() };
	if (row.content?.trim() && !isBinaryText(row.content)) {
		output.push(row.content.trim());
	}
	collectVisibleText(row.parts, output, context);
	collectVisibleText(row.complexContent, output, context);
	collectAttachmentNames(row.metadata, output);

	const deduped = output.filter(
		(value, index) => value && output.indexOf(value) === index,
	);
	return deduped.join("\n").replace(/\r\n/g, "\n");
};

const getScope = (context?: ToolExecutionContext): HistoryScope => {
	const conversationId = context?.runtime?.get(
		THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	);
	const separatorId = context?.runtime?.get(
		THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
	);
	if (
		typeof conversationId !== "string" ||
		!conversationId ||
		typeof separatorId !== "string" ||
		!separatorId
	) {
		throw new Error("Earlier thread history is not available in this segment.");
	}
	return { conversationId, separatorId };
};

/**
 * The join that makes the boundary unforgeable: rows are only reachable when
 * $2 really is a separator of conversation $1.
 */
const HISTORY_BOUNDARY_JOIN = `
	FROM messages m
	JOIN messages boundary
		ON boundary.uuid::text = $2
		AND boundary.conversation_id::text = $1
		AND boundary.type = 'separator'
`;

const HISTORY_SCOPE_WHERE = `
	WHERE m.conversation_id::text = $1
		AND m.type <> 'separator'
		AND m.created_at < boundary.created_at
`;

/** The text ILIKE and the length statistics both run against. */
const HAYSTACK_SQL = `coalesce(m.content, '') || ' ' || coalesce(m.parts::text, '')`;

const HISTORY_SELECT = `
	SELECT
		m.uuid::text AS "messageId",
		m.role AS "role",
		m.content AS "content",
		m.parts AS "parts",
		m.complex_content AS "complexContent",
		m.metadata AS "metadata",
		m.created_at AS "createdAt"
	${HISTORY_BOUNDARY_JOIN}
`;

const searchSchema = z.object({
	query: z.string().trim().min(1).describe("Text to find in earlier messages"),
	prefixLines: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.describe("Context lines before each match (default: 2)"),
	suffixLines: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.describe("Context lines after each match (default: 2)"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe("Maximum matched message IDs to return (default: 8)"),
});

type SearchInput = z.infer<typeof searchSchema>;

interface MatchExcerpt {
	line: number;
	fromLine: number;
	toLine: number;
	lines: string[];
}

export interface ThreadHistoryCorpusStats {
	/** Messages before the boundary. */
	totalDocs: number;
	/** Mean haystack length, in the same unit as the per-document length. */
	averageLength: number;
	/** term → number of messages containing it. */
	documentFrequency: Record<string, number>;
}

const escapeLikePattern = (value: string): string =>
	value.replace(/[\\%_]/gu, (character) => `\\${character}`);

const countOccurrences = (haystack: string, needle: string): number => {
	if (!needle) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
};

/**
 * Split a query into the distinct terms BM25 scores over. Punctuation is
 * trimmed from the edges so `"deploy."` and `deploy` score alike.
 */
export const tokenizeSearchQuery = (
	query: string,
	maxTerms: number = MAX_SEARCH_TERMS,
): string[] => {
	const terms = new Set<string>();
	for (const candidate of query.toLocaleLowerCase().split(/\s+/u)) {
		const term = candidate.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
		if (!term) continue;
		terms.add(term);
		if (terms.size >= maxTerms) break;
	}
	return [...terms];
};

/**
 * Okapi BM25 over one document, plus a bonus when the whole query appears
 * verbatim so phrase searches outrank scattered bag-of-words hits.
 */
export const scoreThreadHistoryMatch = (
	haystack: string,
	terms: string[],
	phrase: string,
	stats: ThreadHistoryCorpusStats,
): number => {
	if (terms.length === 0 || stats.totalDocs <= 0 || stats.averageLength <= 0) {
		return 0;
	}

	const normalized = haystack.toLocaleLowerCase();
	const length = haystack.length || 1;
	const lengthRatio = length / stats.averageLength;
	let score = 0;
	let idfTotal = 0;

	for (const term of terms) {
		const df = Math.min(stats.documentFrequency[term] ?? 0, stats.totalDocs);
		const idf = Math.log(1 + (stats.totalDocs - df + 0.5) / (df + 0.5));
		idfTotal += idf;
		const tf = countOccurrences(normalized, term);
		if (tf === 0) continue;
		score +=
			idf *
			((tf * (BM25_K1 + 1)) /
				(tf + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio)));
	}

	const normalizedPhrase = phrase.toLocaleLowerCase().trim();
	if (
		terms.length > 1 &&
		normalizedPhrase &&
		normalized.includes(normalizedPhrase)
	) {
		score += PHRASE_MATCH_WEIGHT * idfTotal;
	}

	return score;
};

const partsToText = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

/** Mirrors HAYSTACK_SQL so scoring and the SQL statistics agree. */
const buildSearchHaystack = (row: HistoryRow): string =>
	`${row.content ?? ""} ${partsToText(row.parts)}`;

const loadCorpusStats = async (
	services: Services,
	scope: HistoryScope,
	terms: string[],
): Promise<ThreadHistoryCorpusStats> => {
	const filters = terms.map(
		(_, index) =>
			`count(*) FILTER (WHERE ${HAYSTACK_SQL} ILIKE $${index + 3}) AS "df${index}"`,
	);
	const rows = await services.database.raw<Record<string, unknown>>(
		`SELECT
			count(*)::int AS "totalDocs",
			coalesce(avg(length(${HAYSTACK_SQL})), 0)::float AS "averageLength"${
				filters.length > 0 ? `,\n\t\t\t${filters.join(",\n\t\t\t")}` : ""
			}
		${HISTORY_BOUNDARY_JOIN}
		${HISTORY_SCOPE_WHERE}`,
		[
			scope.conversationId,
			scope.separatorId,
			...terms.map((term) => `%${escapeLikePattern(term)}%`),
		],
	);

	const row = rows[0] ?? {};
	const documentFrequency: Record<string, number> = {};
	terms.forEach((term, index) => {
		documentFrequency[term] = Number(row[`df${index}`] ?? 0);
	});
	return {
		totalDocs: Number(row.totalDocs ?? 0),
		averageLength: Number(row.averageLength ?? 0),
		documentFrequency,
	};
};

const findMatchExcerpts = (
	text: string,
	query: string,
	prefixLines: number,
	suffixLines: number,
): MatchExcerpt[] => {
	const lines = text.split("\n");
	const normalizedQuery = query.toLocaleLowerCase();
	const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
	const matchedIndexes: number[] = [];

	lines.forEach((line, index) => {
		const normalizedLine = line.toLocaleLowerCase();
		if (
			normalizedLine.includes(normalizedQuery) ||
			(terms.length > 0 && terms.every((term) => normalizedLine.includes(term)))
		) {
			matchedIndexes.push(index);
		}
	});

	return matchedIndexes.slice(0, 2).map((index) => {
		const start = Math.max(0, index - prefixLines);
		const end = Math.min(lines.length, index + suffixLines + 1);
		return {
			line: index + 1,
			fromLine: start + 1,
			toLine: end,
			lines: lines
				.slice(start, end)
				.map(
					(line, offset) =>
						`L${start + offset + 1}${start + offset === index ? ">" : "|"} ${line}`,
				),
		};
	});
};

const formatDate = (value: string | Date): string =>
	value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export const createThreadHistorySearchTool: ToolFactory<
	SearchInput,
	Services
> = (services): Tool<SearchInput> => ({
	name: THREAD_HISTORY_SEARCH_TOOL,
	title: "Search earlier thread messages",
	description:
		"Search messages from before the current thread separator. Matching is lexical (full-text plus substring), ranked by BM25. Returns message IDs and grep-style excerpts whose line numbers match a compact thread_history_read of the same message.",
	schema: searchSchema,
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	execute: async (input, context): Promise<ToolExecutionResult> => {
		try {
			const scope = getScope(context);
			const prefixLines = input.prefixLines ?? 2;
			const suffixLines = input.suffixLines ?? 2;
			const limit = input.limit ?? 8;
			const searchVector = buildThreadHistorySearchVectorSql("m");
			const candidates = await services.database.raw<HistoryRow>(
				`${HISTORY_SELECT}
				${HISTORY_SCOPE_WHERE}
					AND (
						${searchVector}
							@@ websearch_to_tsquery('simple'::regconfig, $3)
						OR coalesce(m.content, '') ILIKE '%' || $3 || '%'
						OR coalesce(m.parts::text, '') ILIKE '%' || $3 || '%'
					)
				ORDER BY m.created_at DESC
				LIMIT $4`,
				[
					scope.conversationId,
					scope.separatorId,
					input.query,
					Math.min(limit * 8, MAX_SEARCH_CANDIDATES),
				],
			);

			if (candidates.length === 0) {
				return {
					content: `No earlier messages matched "${input.query}".`,
					meta: { truncated: false, matchedMessageIds: [] },
				};
			}

			const terms = tokenizeSearchQuery(input.query);
			const stats = await loadCorpusStats(services, scope, terms);
			// Stable sort: equal scores keep the SQL's created_at DESC ordering.
			const ranked = candidates
				.map((row) => ({
					row,
					score: scoreThreadHistoryMatch(
						buildSearchHaystack(row),
						terms,
						input.query,
						stats,
					),
				}))
				.sort((left, right) => right.score - left.score);

			const blocks: string[] = [];
			const matchedIds: string[] = [];
			let truncated = false;
			for (const { row } of ranked) {
				if (matchedIds.length >= limit) break;
				const text = normalizeThreadHistoryMessage(row, "compact");
				const excerpts = findMatchExcerpts(
					text,
					input.query,
					prefixLines,
					suffixLines,
				);
				if (excerpts.length === 0) continue;

				const totalLines = text.split("\n").length;
				const block = [
					`messageId: ${row.messageId} · ${row.role} · ${formatDate(row.createdAt)} · ${totalLines} lines`,
					...excerpts.flatMap((excerpt) => [
						`match: L${excerpt.line} · lines ${excerpt.fromLine}-${excerpt.toLine}/${totalLines}`,
						...excerpt.lines,
					]),
				].join("\n");
				if ([...blocks, block].join("\n\n").length > SEARCH_RESPONSE_BUDGET) {
					truncated = true;
					break;
				}
				matchedIds.push(row.messageId);
				blocks.push(block);
			}

			const content =
				blocks.length > 0
					? `${blocks.join("\n\n")}${truncated ? "\n\n[More matches omitted: narrow the query or lower context lines.]" : ""}`
					: `No earlier messages matched "${input.query}".`;
			return {
				content,
				meta: { truncated, matchedMessageIds: matchedIds },
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "History search failed";
			return { content: `Error: ${message}`, isError: true };
		}
	},
});

const readSchema = z.object({
	messageIds: z
		.array(z.string().min(1))
		.min(1)
		.max(8)
		.describe("One to eight message IDs returned by thread_history_search"),
	fromLine: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Inclusive first line (default: 1)"),
	toLine: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe(
			`Inclusive last line (default: fromLine + 79, capped at fromLine + ${MAX_READ_LINES - 1})`,
		),
	mode: z
		.enum(["compact", "detail"])
		.optional()
		.describe(
			"compact (default) renders prose and collapses each tool call and result to one line; detail renders tool arguments and outputs in full. Line numbers differ between modes.",
		),
});

type ReadInput = z.infer<typeof readSchema>;

export const createThreadHistoryReadTool: ToolFactory<ReadInput, Services> = (
	services,
): Tool<ReadInput> => ({
	name: THREAD_HISTORY_READ_TOOL,
	title: "Read earlier thread messages",
	description:
		"Read earlier messages by ID over a bounded line range. Start in compact mode; switch to detail only when you need a tool call's arguments or output. Line numbers are mode-specific, so keep the same mode when continuing a read.",
	schema: readSchema,
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	execute: async (input, context): Promise<ToolExecutionResult> => {
		try {
			const scope = getScope(context);
			const mode: ThreadHistoryTextMode = input.mode ?? "compact";
			if (input.toLine && input.toLine < (input.fromLine ?? 1)) {
				return {
					content: "Error: toLine must be greater than or equal to fromLine.",
					isError: true,
				};
			}

			const rows = await services.database.raw<HistoryRow>(
				`${HISTORY_SELECT}
				${HISTORY_SCOPE_WHERE}
					AND m.uuid::text = ANY($3::text[])`,
				[scope.conversationId, scope.separatorId, input.messageIds],
			);
			const byId = new Map(rows.map((row) => [row.messageId, row]));
			const blocks: string[] = [];
			const continuation: Record<string, number> = {};
			let used = 0;

			for (const messageId of input.messageIds) {
				const row = byId.get(messageId);
				if (!row) {
					const unavailable = `messageId: ${messageId}\n[Unavailable outside this thread boundary.]`;
					if (used + unavailable.length <= READ_RESPONSE_BUDGET) {
						blocks.push(unavailable);
						used += unavailable.length + 2;
					}
					continue;
				}

				const text = normalizeThreadHistoryMessage(row, mode);
				const lines = text.split("\n");
				const fromLine = input.fromLine ?? 1;
				const requestedTo = input.toLine ?? fromLine + 79;
				const toLine = Math.min(requestedTo, fromLine + MAX_READ_LINES - 1);
				const start = Math.min(Math.max(0, fromLine - 1), lines.length);
				const end = Math.min(Math.max(start, toLine), lines.length);
				const header = `messageId: ${row.messageId} · ${row.role} · ${formatDate(row.createdAt)} · ${mode} · lines ${start + 1}-${end}/${lines.length}`;
				const selected = lines.slice(start, end);
				const rendered: string[] = [header];

				for (let index = 0; index < selected.length; index += 1) {
					const lineNumber = start + index + 1;
					const line = `L${lineNumber}| ${selected[index]}`;
					const projected = used + rendered.join("\n").length + line.length + 2;
					if (projected > READ_RESPONSE_BUDGET) {
						continuation[messageId] = lineNumber;
						break;
					}
					rendered.push(line);
				}

				if (
					rendered.length > 1 ||
					used + header.length <= READ_RESPONSE_BUDGET
				) {
					const block = rendered.join("\n");
					blocks.push(block);
					used += block.length + 2;
				}
				if (used >= READ_RESPONSE_BUDGET) break;
			}

			for (const messageId of input.messageIds) {
				if (
					!byId.has(messageId) ||
					blocks.some((block) => block.includes(`messageId: ${messageId}`))
				)
					continue;
				continuation[messageId] = input.fromLine ?? 1;
			}

			const continuationEntries = Object.entries(continuation);
			const footer = continuationEntries.length
				? `\n\n[Response limit reached. Continue in ${mode} mode with: ${continuationEntries
						.map(([id, line]) => `${id} nextFromLine=${line}`)
						.join(", ")}]`
				: "";
			return {
				content: `${blocks.join("\n\n")}${footer}`,
				meta: {
					mode,
					truncated: continuationEntries.length > 0,
					nextFromLine: continuation,
				},
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "History read failed";
			return { content: `Error: ${message}`, isError: true };
		}
	},
});

toolRegistry.register(
	THREAD_HISTORY_SEARCH_TOOL,
	createThreadHistorySearchTool,
);
toolRegistry.register(THREAD_HISTORY_READ_TOOL, createThreadHistoryReadTool);

declare global {
	interface ToolTypeRegistry {
		[THREAD_HISTORY_SEARCH_TOOL]: {
			input: SearchInput;
			services: Services;
		};
		[THREAD_HISTORY_READ_TOOL]: {
			input: ReadInput;
			services: Services;
		};
	}
}
