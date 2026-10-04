import {
	isKnownProvider,
	PROVIDER_REGISTRY,
} from "@/services/llm/provider-registry";
import type { UsageMessageRow, UsageRequest, UsageToolShare } from "../types";
import type { FeatureResolver } from "./usage-features";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** jsonb can arrive parsed or as text, depending on the driver. */
const parseJson = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const toNumber = (value: unknown): number => {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
};

const toText = (value: unknown): string =>
	typeof value === "string" ? value : "";

export const toTime = (value: unknown): number => {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number") return value;
	if (typeof value === "string" && value) {
		// `timestamp` without zone is written in UTC.
		const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value)
			? value
			: `${value.replace(" ", "T")}Z`;
		const time = Date.parse(iso);
		return Number.isNaN(time) ? 0 : time;
	}
	return 0;
};

export const isLocalProvider = (provider: string): boolean =>
	isKnownProvider(provider) && PROVIDER_REGISTRY[provider].isLocal;

interface RequestTokens {
	input: number;
	cached: number;
	output: number;
	reasoning: number;
	cost?: number;
	estimated: boolean;
}

const readTokens = (usage: JsonRecord): RequestTokens => {
	const input = toNumber(usage.prompt_tokens);
	const output = toNumber(usage.completion_tokens);
	return {
		input,
		cached: Math.min(toNumber(usage.cached_tokens), input),
		output,
		reasoning: Math.min(toNumber(usage.reasoning_tokens), output),
		...(typeof usage.cost === "number" && Number.isFinite(usage.cost)
			? { cost: usage.cost }
			: {}),
		estimated: usage.estimated === true,
	};
};

/**
 * One entry per provider request. Replies saved before per-request usage existed
 * only carry the total, which then counts as a single request.
 */
export const readRequestTokens = (usage: unknown): RequestTokens[] => {
	if (!isRecord(usage)) return [];
	const total = readTokens(usage);
	const calls = Array.isArray(usage.calls)
		? usage.calls.filter(isRecord).map(readTokens)
		: [];
	if (!calls.length) {
		return total.input + total.output > 0 || total.cost !== undefined
			? [total]
			: [];
	}
	// A provider can price the whole reply but not each request: spread it by size.
	const totalCost = total.cost;
	if (
		totalCost !== undefined &&
		calls.every((call) => call.cost === undefined)
	) {
		const size = calls.reduce((sum, call) => sum + call.input + call.output, 0);
		return calls.map((call) => ({
			...call,
			cost:
				size > 0
					? (totalCost * (call.input + call.output)) / size
					: totalCost / calls.length,
		}));
	}
	return calls;
};

interface ToolResultRef {
	id: string;
	chars: number;
}

interface ToolIdentity {
	name: string;
	source?: string;
}

/**
 * The tool results each request read, from the reply's ordered parts:
 * `assistant → tool… → assistant → …`. The results between assistant part k-1
 * and k are what request k was sent. Results after the last assistant part were
 * never read by a request, so they are left out.
 */
export const readToolInputs = (
	parts: unknown,
): { segments: ToolResultRef[][]; names: Map<string, string> } => {
	const segments: ToolResultRef[][] = [];
	const names = new Map<string, string>();
	const list = parseJson(parts);
	if (!Array.isArray(list)) return { segments, names };
	let pending: ToolResultRef[] = [];
	for (const part of list) {
		if (!isRecord(part)) continue;
		const role = toText(part.r);
		if (role === "tool") {
			const id = toText(part.id);
			if (id) pending.push({ id, chars: toNumber(part.n) });
		} else if (role === "assistant") {
			segments.push(pending);
			pending = [];
			if (Array.isArray(part.c)) {
				for (const call of part.c) {
					if (!isRecord(call)) continue;
					const id = toText(call.id);
					const name = toText(call.name);
					if (id && name) names.set(id, name);
				}
			}
		}
	}
	return { segments, names };
};

const readToolIdentities = (
	toolExecutions: unknown,
	names: Map<string, string>,
): Map<string, ToolIdentity> => {
	const identities = new Map<string, ToolIdentity>();
	for (const [id, name] of names) identities.set(id, { name });
	const list = parseJson(toolExecutions);
	if (!Array.isArray(list)) return identities;
	for (const record of list) {
		if (!isRecord(record)) continue;
		const id = toText(record.id);
		const name = toText(record.name) || identities.get(id)?.name || "";
		if (!id || !name) continue;
		const source = toText(record.source);
		identities.set(id, { name, ...(source ? { source } : {}) });
	}
	return identities;
};

const UNKNOWN_TOOL = "unknown";

/**
 * Turns one saved reply into its model requests, each carrying the tool results
 * it read. Requests and assistant parts are matched from the end: the last
 * request wrote the final answer, and extra requests (context steps that ran
 * before the agent) sit at the start, where they count as base chat.
 */
export const toUsageRequests = (
	row: UsageMessageRow,
	resolveFeature: FeatureResolver,
): UsageRequest[] => {
	const calls = readRequestTokens(parseJson(row.usage));
	if (!calls.length) return [];
	const { segments: partSegments, names } = readToolInputs(row.parts);
	const identities = readToolIdentities(row.toolExecutions, names);

	// No parts saved (older or cron replies): later requests share every tool run.
	const segments =
		partSegments.length || !identities.size
			? partSegments
			: [[], [...identities.keys()].map((id) => ({ id, chars: 0 }))];
	const fillLast = !partSegments.length && identities.size > 0;
	const offset = calls.length - segments.length;
	const seen = new Set<string>();

	const provider = row.provider ?? "";
	const base = {
		messageId: row.id,
		conversationId: row.conversationId,
		conversationTitle: row.conversationTitle ?? "",
		at: toTime(row.createdAt),
		agent: row.agentName || row.flowName || "",
		model: row.model ?? "",
		provider,
		local: isLocalProvider(provider),
	};

	return calls.map((call, index) => {
		const segment =
			(fillLast && index > 0
				? segments[segments.length - 1]
				: segments[index - offset]) ?? [];
		const totalChars = segment.reduce((sum, ref) => sum + ref.chars, 0);
		const tools: UsageToolShare[] = segment.map((ref) => {
			const identity = identities.get(ref.id);
			const tool = identity?.name ?? UNKNOWN_TOOL;
			const first = !seen.has(ref.id);
			seen.add(ref.id);
			return {
				tool,
				feature: resolveFeature(tool, identity?.source),
				weight: totalChars > 0 ? ref.chars / totalChars : 1 / segment.length,
				resultChars: first ? ref.chars : 0,
				calls: first ? 1 : 0,
			};
		});
		return {
			...base,
			...(base.local
				? { cost: 0 }
				: call.cost !== undefined
					? { cost: call.cost }
					: {}),
			inputTokens: call.input,
			cachedTokens: call.cached,
			outputTokens: call.output,
			reasoningTokens: call.reasoning,
			estimated: call.estimated,
			tools,
		};
	});
};
