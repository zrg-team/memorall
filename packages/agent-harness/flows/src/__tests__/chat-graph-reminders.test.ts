import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../graph/agent/graph.js";
import "../graph/foundation/graph.js";
import "../steps/common/agent-completion.js";
import "../steps/common/chat-completion.js";
import type {
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionRequest,
} from "../interfaces/engine/messages.js";
import type { BaseTool } from "../interfaces/engine/tool.js";
import type { IFlowLLMService } from "../interfaces/services/llm.js";
import { graphRegistry } from "../registries/graph-registry.js";
import {
	isSystemReminderMessage,
	remindersSentIn,
	systemReminderMessage,
	withSystemReminders,
} from "../graph/system-reminders.js";

/**
 * Context a caller hands a run for this message only — the page the user is
 * on, what they pointed at — goes right after the user's message, and stays
 * there. Anywhere earlier it rewrites the cached prefix of everything behind
 * it; moved to the end of each request instead, every request diverges from
 * the one before at the reminder.
 */

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
): ChatCompletionChunk => ({
	id: "chunk-1",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [{ index: 0, delta, finish_reason: null }],
});

const answer = chunk({ role: "assistant", content: "ok" });

const toolCall = chunk({
	role: "assistant",
	content: null,
	tool_calls: [
		{
			index: 0,
			id: "call_1",
			type: "function",
			function: { name: "noop", arguments: "{}" },
		},
	],
});

/** Answers with the given chunks in turn, recording every request. */
const recordingLlm = (
	requests: ChatCompletionRequest[],
	replies: ChatCompletionChunk[] = [answer],
): IFlowLLMService => ({
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 128_000,
	getMaxResponseTokens: async () => 1024,
	chatCompletions: ((request: ChatCompletionRequest) => {
		const reply = replies[requests.length] ?? answer;
		requests.push(request);
		return (async function* () {
			yield reply;
		})();
	}) as IFlowLLMService["chatCompletions"],
});

const noopTool: BaseTool = {
	name: "noop",
	description: "noop test tool",
	schema: z.object({}),
	execute: async () => "done",
};

const PAGE = "Current page: https://x.test/listing/1";

const run = async (
	graphType: "agent" | "foundation",
	{
		messages = [
			{ role: "system", content: "Be helpful." },
			{ role: "user", content: "what is this?" },
		],
		replies,
		step = "agent-completion",
	}: {
		messages?: ChatCompletionMessageParam[];
		replies?: ChatCompletionChunk[];
		step?: "agent-completion" | "chat-completion";
	} = {},
) => {
	const requests: ChatCompletionRequest[] = [];
	const events: Array<Record<string, unknown>> = [];
	let finalState: Record<string, unknown> = {};
	const { graph, getInitialState } = graphRegistry.createChatGraph(
		graphType,
		{ llm: recordingLlm(requests, replies) } as never,
		{
			graphType,
			steps: [
				{
					id: "completion_1",
					name: step,
					enabled: true,
					config: step === "agent-completion" ? { tools: [noopTool] } : {},
				},
			],
		} as never,
	);
	const state = getInitialState({
		messages,
		contextQueries: [],
		reminders: [PAGE],
	});
	for await (const [mode, payload] of (await graph.stream(state, {
		streamMode: ["custom", "values"],
	})) as AsyncIterable<[string, Record<string, unknown>]>) {
		if (mode === "custom") events.push(payload);
		if (mode === "values") finalState = payload;
	}
	return { requests, events, finalState };
};

const reminderContent = `<system-reminder>\n${PAGE}\n</system-reminder>`;

describe("reminders handed to a chat graph", () => {
	for (const graphType of ["agent", "foundation"] as const) {
		it(`attaches them right after the user's message in the ${graphType} graph`, async () => {
			const { requests } = await run(graphType);

			expect(requests).toHaveLength(1);
			const messages = requests[0]?.messages ?? [];
			expect(messages.slice(-2)).toEqual([
				{ role: "user", content: "what is this?" },
				{ role: "user", content: reminderContent },
			]);
			// Not in the system prompt, where it would change the opening bytes.
			const system = messages.find((message) => message.role === "system");
			expect(String(system?.content)).not.toContain("x.test");
		});

		it(`keeps them in place across tool round-trips in the ${graphType} graph`, async () => {
			const { requests, events } = await run(graphType, {
				replies: [toolCall, answer],
			});

			expect(requests).toHaveLength(2);
			const [first, second] = requests.map((request) => request.messages);
			// Every request extends the one before it byte for byte: the reminder
			// is where it was, ahead of the tool round-trip, not moved behind it.
			expect(second?.slice(0, first?.length)).toEqual(first);
			expect(second?.slice(first?.length).map((m) => m.role)).toEqual([
				"assistant",
				"tool",
			]);
			expect(
				second?.filter((message) => message.content === reminderContent),
			).toHaveLength(1);
			// Reported once, so the stored reply keeps it where it was read.
			expect(
				events.filter((event) => event.type === "system-reminder"),
			).toEqual([{ type: "system-reminder", content: reminderContent }]);
		});
	}

	it("commits them to the conversation where they were sent", async () => {
		const { finalState } = await run("agent", { replies: [toolCall, answer] });

		const messages = finalState.messages as ChatCompletionMessageParam[];
		expect(messages.map((message) => message.role)).toEqual([
			"system",
			"user",
			"user",
			"assistant",
			"tool",
			"assistant",
		]);
		expect(messages[2]).toEqual({ role: "user", content: reminderContent });
	});

	it("leaves an earlier turn's reminder where it was and adds this turn's after the new message", async () => {
		const earlier = { role: "user" as const, content: reminderContent };
		const history: ChatCompletionMessageParam[] = [
			{ role: "system", content: "Be helpful." },
			{ role: "user", content: "what is this?" },
			earlier,
			{ role: "assistant", content: "A listing." },
			{ role: "user", content: "and the price?" },
		];
		const { requests } = await run("agent", { messages: history });

		const messages = requests[0]?.messages ?? [];
		// The earlier turn reads exactly as it was sent.
		expect(messages.slice(1, 4)).toEqual(history.slice(1, 4));
		// This turn's context follows this turn's message.
		expect(messages.slice(-2)).toEqual([
			{ role: "user", content: "and the price?" },
			{ role: "user", content: reminderContent },
		]);
	});

	it("reports them from a single completion so the reply can keep them", async () => {
		const { requests, events } = await run("foundation", {
			step: "chat-completion",
		});

		expect(requests[0]?.messages.at(-1)).toEqual({
			role: "user",
			content: reminderContent,
		});
		expect(events).toContainEqual({
			type: "system-reminder",
			content: reminderContent,
		});
	});
});

describe("system reminder messages", () => {
	it("wraps each block in its own tag, in one message", () => {
		expect(systemReminderMessage(["a", " b ", "a", ""])).toEqual({
			role: "user",
			content:
				"<system-reminder>\na\n</system-reminder>\n\n<system-reminder>\nb\n</system-reminder>",
		});
		expect(systemReminderMessage([])).toBeUndefined();
	});

	it("only attaches what the conversation has not been given", () => {
		const sent = systemReminderMessage(["clock", "tasks"]);
		expect(remindersSentIn(sent ? [sent] : [])).toEqual(
			new Set(["clock", "tasks"]),
		);
		expect(systemReminderMessage(["clock", "tasks"], sent ? [sent] : [])).toBe(
			undefined,
		);
		expect(
			systemReminderMessage(["clock", "inbox"], sent ? [sent] : []),
		).toEqual({
			role: "user",
			content: "<system-reminder>\ninbox\n</system-reminder>",
		});
	});

	it("tells a reminder from something the user wrote", () => {
		expect(
			isSystemReminderMessage({ role: "user", content: reminderContent }),
		).toBe(true);
		expect(
			isSystemReminderMessage({
				role: "user",
				content: [{ type: "text", text: reminderContent }],
			}),
		).toBe(true);
		expect(
			isSystemReminderMessage({
				role: "user",
				content: "what does <system-reminder> mean?",
			}),
		).toBe(false);
		expect(
			isSystemReminderMessage({
				role: "tool",
				content: reminderContent,
			} as never),
		).toBe(false);
	});

	it("leaves a request without reminders untouched", () => {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "user", content: "hi" },
		];
		expect(withSystemReminders(messages, undefined)).toBe(messages);
		expect(withSystemReminders(messages, ["  "])).toBe(messages);
	});
});
