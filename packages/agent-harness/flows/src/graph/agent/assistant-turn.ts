import type {
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "../../interfaces/engine/messages.js";
import type { BaseLLM } from "../../interfaces/services/llm.js";
import type { FlowRunLifecycle } from "../../context/run-lifecycle.js";
import { logInfo, logWarn } from "../../logging/logger.js";
import { estimatePromptTokens } from "../../utils/token-usage.js";
import {
	describeTokenBudgetLimit,
	nextCompletionBudget,
	parseTokenBudgetLimit,
	promptBudgetFromLimit,
	TokenBudgetError,
	type TokenBudgetLimit,
} from "../../utils/token-budget.js";

export type AssembledToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export function mergeStreamedToolCall(
	toolCallsMap: Map<number, AssembledToolCall>,
	tc: NonNullable<
		ChatCompletionChunk["choices"][number]["delta"]["tool_calls"]
	>[number],
): void {
	const existing = toolCallsMap.get(tc.index);
	if (existing) {
		if (tc.id) {
			existing.id = tc.id;
		}
		if (tc.function?.name) {
			existing.function.name += tc.function.name;
		}
		if (tc.function?.arguments) {
			existing.function.arguments += tc.function.arguments;
		}
		return;
	}

	toolCallsMap.set(tc.index, {
		id: tc.id || crypto.randomUUID(),
		type: "function",
		function: {
			name: tc.function?.name || "",
			arguments: tc.function?.arguments || "",
		},
	});
}

/** How many times a refused request is reshaped before the run gives up. */
export const MAX_TOKEN_BUDGET_ATTEMPTS = 3;

/** The two halves of the agent's context, as the graph stores them. */
export interface TurnConversation {
	messages: ChatCompletionMessageParam[];
	outputMessages: ChatCompletionMessageParam[];
}

export interface AssistantTurn {
	content: string;
	toolCalls: AssembledToolCall[];
	/** The conversation the turn actually ran on — shorter if it was compacted. */
	conversation: TurnConversation;
	/** Whether recovering from a refusal changed the conversation. */
	compacted: boolean;
}

export interface AssistantTurnContext {
	llm: Pick<BaseLLM, "chatCompletions" | "getMaxModelTokens">;
	tools: ChatCompletionTool[];
	lifecycle?: Pick<FlowRunLifecycle, "compact">;
	onChunk?: (chunk: ChatCompletionChunk) => void;
	maxAttempts?: number;
}

interface StreamOutcome {
	content: string;
	toolCalls: AssembledToolCall[];
}

const contextTokensOf = async (
	llm: AssistantTurnContext["llm"],
): Promise<number | undefined> => {
	try {
		const tokens = await llm.getMaxModelTokens();
		return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
	} catch {
		// The window is a nice-to-have here: the provider's own numbers drive the
		// retry, and this only fills in when it did not name one.
		return undefined;
	}
};

/**
 * One assistant turn, recovered rather than surrendered when the provider
 * refuses it for budget.
 *
 * A refusal — no credit for a reply that long, or a prompt past the context
 * window — arrives as an HTTP error before a single token is streamed, and it
 * always carries the ceiling the next attempt has to respect. That is enough to
 * fix the request without the user doing anything: ask for a shorter completion,
 * shorten the conversation, send it again. Showing the provider's sentence to
 * the user instead ends a run that had an obvious way forward.
 *
 * Both levers are pulled because either can be the binding one. A credit refusal
 * is usually solved by capping `max_tokens`, since the prompt was already paid
 * for; a context refusal needs the prompt itself to get smaller. When a ceiling
 * is so low that capping alone leaves no room to answer in, compacting the
 * conversation is what buys that room back.
 *
 * Retrying stops the moment it stops being honest: once a chunk has reached the
 * reader, a second attempt would duplicate what they have already seen, and once
 * neither lever moves, the run fails with an explanation instead of a loop.
 */
export async function streamAssistantTurn(
	conversation: TurnConversation,
	context: AssistantTurnContext,
): Promise<AssistantTurn> {
	const maxAttempts = context.maxAttempts ?? MAX_TOKEN_BUDGET_ATTEMPTS;
	let current = conversation;
	let maxTokens: number | undefined;
	let compacted = false;
	let attempt = 0;

	for (;;) {
		attempt += 1;
		let emitted = false;

		try {
			const outcome = await runStream(current, context, maxTokens, () => {
				emitted = true;
			});
			return { ...outcome, conversation: current, compacted };
		} catch (error) {
			const limit = parseTokenBudgetLimit(error);
			if (!limit) throw error;

			if (emitted) {
				// Part of the answer is already on the reader's screen. Replaying the
				// turn would repeat it, so the failure is theirs to see.
				logWarn(
					"[AGENT] Token budget refused mid-stream; not retrying a partly delivered turn.",
				);
				throw budgetFailure(limit, error);
			}

			if (attempt >= maxAttempts) {
				logWarn(
					`[AGENT] Token budget still refused after ${attempt} attempts.`,
				);
				throw budgetFailure(limit, error);
			}

			const recovery = await reshapeRequest(current, context, limit, maxTokens);
			if (!recovery) {
				throw budgetFailure(limit, error);
			}

			current = recovery.conversation;
			maxTokens = recovery.maxTokens;
			compacted = compacted || recovery.compacted;

			logInfo(
				"[AGENT] Retrying after a token-budget refusal —",
				`kind: ${limit.kind},`,
				`max_tokens: ${maxTokens ?? "unset"},`,
				`compacted: ${recovery.compacted}`,
			);
		}
	}
}

async function runStream(
	conversation: TurnConversation,
	context: AssistantTurnContext,
	maxTokens: number | undefined,
	markEmitted: () => void,
): Promise<StreamOutcome> {
	const messages = [...conversation.messages, ...conversation.outputMessages];

	const stream = context.llm.chatCompletions({
		messages,
		tools: context.tools,
		tool_choice: "auto",
		stream: true,
		...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
	}) as AsyncIterable<ChatCompletionChunk>;

	let content = "";
	const toolCallsMap = new Map<number, AssembledToolCall>();

	for await (const chunk of stream) {
		markEmitted();
		const delta = chunk.choices[0]?.delta;
		if (delta?.content) content += delta.content;
		context.onChunk?.(chunk);

		if (delta?.tool_calls) {
			for (const tc of delta.tool_calls) {
				mergeStreamedToolCall(toolCallsMap, tc);
			}
		}
	}

	return { content, toolCalls: Array.from(toolCallsMap.values()) };
}

interface Reshaped {
	conversation: TurnConversation;
	maxTokens?: number;
	compacted: boolean;
}

/**
 * A smaller version of the same request, or undefined when there isn't one.
 *
 * Undefined is the honest answer when neither lever moved: retrying an identical
 * request produces an identical refusal.
 */
async function reshapeRequest(
	conversation: TurnConversation,
	context: AssistantTurnContext,
	limit: TokenBudgetLimit,
	previousMaxTokens: number | undefined,
): Promise<Reshaped | undefined> {
	const completionBudget = nextCompletionBudget(limit, previousMaxTokens);
	const promptBudget = promptBudgetFromLimit(limit, {
		contextTokens: await contextTokensOf(context.llm),
		currentPromptTokens: estimatePromptTokens([
			...conversation.messages,
			...conversation.outputMessages,
		]),
	});

	// Capping the completion is the cheaper fix and leaves the conversation
	// intact, so it is only skipped when it cannot be the binding constraint.
	const shouldCompact =
		promptBudget !== undefined &&
		(completionBudget === undefined || limit.kind === "context");

	let next = conversation;
	let compacted = false;

	if (shouldCompact && context.lifecycle) {
		const patch = await context.lifecycle.compact(
			conversation as unknown as Record<string, unknown>,
			{ reason: "token-budget", budgetTokens: promptBudget },
		);
		if (patch) {
			next = { ...conversation, ...(patch as Partial<TurnConversation>) };
			compacted = true;
		}
	}

	if (completionBudget === undefined && !compacted) {
		return undefined;
	}

	return {
		conversation: next,
		maxTokens: completionBudget ?? previousMaxTokens,
		compacted,
	};
}

const budgetFailure = (
	limit: TokenBudgetLimit,
	cause: unknown,
): TokenBudgetError => {
	const error = new TokenBudgetError(describeTokenBudgetLimit(limit), limit);
	if (cause instanceof Error) {
		error.cause = cause;
	}
	return error;
};
