import z from "zod";
import type {
	Tool,
	ToolExecutionContext,
	ToolExecutionResult,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
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

type Services = Pick<AllServices, "database">;

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

const collectVisibleText = (value: unknown, output: string[]): void => {
	const parsed = safeJsonParse(value);
	if (typeof parsed === "string") {
		if (!isBinaryText(parsed) && parsed.trim()) output.push(parsed.trim());
		return;
	}
	if (Array.isArray(parsed)) {
		for (const item of parsed) collectVisibleText(item, output);
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

	if (typeof parsed.role === "string" && "content" in parsed) {
		const roleOutput: string[] = [];
		collectVisibleText(parsed.content, roleOutput);
		if (roleOutput.length > 0) {
			output.push(`[${parsed.role}]`);
			output.push(...roleOutput);
		}
		return;
	}

	if (typeof parsed.text === "string") {
		collectVisibleText(parsed.text, output);
		return;
	}

	if (typeof parsed.content === "string") {
		collectVisibleText(parsed.content, output);
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

export const normalizeThreadHistoryMessage = (row: HistoryRow): string => {
	const output: string[] = [];
	if (row.content?.trim() && !isBinaryText(row.content)) {
		output.push(row.content.trim());
	}
	collectVisibleText(row.parts, output);
	collectVisibleText(row.complexContent, output);
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

const HISTORY_SELECT = `
	SELECT
		m.uuid::text AS "messageId",
		m.role AS "role",
		m.content AS "content",
		m.parts AS "parts",
		m.complex_content AS "complexContent",
		m.metadata AS "metadata",
		m.created_at AS "createdAt"
	FROM messages m
	JOIN messages boundary
		ON boundary.uuid::text = $2
		AND boundary.conversation_id::text = $1
		AND boundary.type = 'separator'
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
		"Search messages before the current thread separator. Returns matched message IDs and grep-style line excerpts. Use thread_history_read with returned IDs for more context.",
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
				WHERE m.conversation_id::text = $1
					AND m.type <> 'separator'
					AND m.created_at < boundary.created_at
					AND (
						${searchVector}
							@@ websearch_to_tsquery('simple'::regconfig, $3)
						OR coalesce(m.content, '') ILIKE '%' || $3 || '%'
						OR coalesce(m.parts::text, '') ILIKE '%' || $3 || '%'
					)
				ORDER BY
					ts_rank_cd(
						${searchVector},
						websearch_to_tsquery('simple'::regconfig, $3)
					) DESC,
					m.created_at DESC
				LIMIT $4`,
				[scope.conversationId, scope.separatorId, input.query, limit * 4],
			);

			const blocks: string[] = [];
			const matchedIds: string[] = [];
			let truncated = false;
			for (const row of candidates) {
				if (matchedIds.length >= limit) break;
				const text = normalizeThreadHistoryMessage(row);
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
		.describe("Inclusive last line (default: fromLine + 79)"),
	readAll: z
		.boolean()
		.optional()
		.describe("Read all lines of each message; ignores fromLine/toLine"),
});

type ReadInput = z.infer<typeof readSchema>;

export const createThreadHistoryReadTool: ToolFactory<ReadInput, Services> = (
	services,
): Tool<ReadInput> => ({
	name: THREAD_HISTORY_READ_TOOL,
	title: "Read earlier thread messages",
	description:
		"Read one or more earlier messages by ID with line numbers. Supply fromLine/toLine for a bounded range, or readAll=true for complete messages.",
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
			if (
				!input.readAll &&
				input.toLine &&
				input.toLine < (input.fromLine ?? 1)
			) {
				return {
					content: "Error: toLine must be greater than or equal to fromLine.",
					isError: true,
				};
			}

			const rows = await services.database.raw<HistoryRow>(
				`${HISTORY_SELECT}
				WHERE m.conversation_id::text = $1
					AND m.type <> 'separator'
					AND m.created_at < boundary.created_at
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

				const text = normalizeThreadHistoryMessage(row);
				const lines = text.split("\n");
				const fromLine = input.readAll ? 1 : (input.fromLine ?? 1);
				const requestedTo = input.readAll
					? lines.length
					: (input.toLine ?? fromLine + 79);
				const toLine = input.readAll
					? requestedTo
					: Math.min(requestedTo, fromLine + MAX_READ_LINES - 1);
				const start = Math.min(Math.max(0, fromLine - 1), lines.length);
				const end = Math.min(Math.max(start, toLine), lines.length);
				const header = `messageId: ${row.messageId} · ${row.role} · ${formatDate(row.createdAt)} · lines ${start + 1}-${end}/${lines.length}`;
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
				continuation[messageId] = input.readAll ? 1 : (input.fromLine ?? 1);
			}

			const continuationEntries = Object.entries(continuation);
			const footer = continuationEntries.length
				? `\n\n[Response limit reached. Continue with: ${continuationEntries
						.map(([id, line]) => `${id} nextFromLine=${line}`)
						.join(", ")}]`
				: "";
			return {
				content: `${blocks.join("\n\n")}${footer}`,
				meta: {
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
