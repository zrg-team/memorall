import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	payloads: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: { execute: mocks.execute },
}));

import { embeddedChatService } from "@/embedded/chat-service";

const chunk = (delta: Record<string, unknown>) => ({
	status: "processing",
	result: {
		type: "chunk",
		chunk: {
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "m",
			choices: [{ index: 0, delta, finish_reason: null }],
		},
	},
});

const runWith = (progress: unknown[]) => {
	mocks.execute.mockImplementation(
		async (_name: string, payload: Record<string, unknown>) => {
			mocks.payloads.push(payload);
			return {
				stream: (async function* () {
					yield* progress;
				})(),
			};
		},
	);
};

describe("tool calls across an agent run", () => {
	it("keeps each request's calls apart even though both stream at index 0", async () => {
		// Every model request numbers its tool calls from 0. Grouping by index
		// alone folded the second call into the first — its name and id
		// overwritten, both argument strings run together.
		runWith([
			chunk({
				role: "assistant",
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						type: "function",
						function: { name: "co_agent_observe", arguments: '{"scope":' },
					},
				],
			}),
			chunk({
				tool_calls: [{ index: 0, function: { arguments: '"page"}' } }],
			}),
			chunk({ role: "tool", tool_call_id: "call-1", content: "page text" }),
			chunk({
				role: "assistant",
				tool_calls: [
					{
						index: 0,
						id: "call-2",
						type: "function",
						function: { name: "web_search", arguments: '{"q":"metro"}' },
					},
				],
			}),
			chunk({ role: "tool", tool_call_id: "call-2", content: "results" }),
			chunk({ role: "assistant", content: "Done." }),
		]);
		const seen: unknown[] = [];

		const result = await embeddedChatService.chatStream({
			messages: [
				{ id: "u", role: "user", content: "q", timestamp: new Date() },
			],
			model: "m",
			mode: "custom",
			onToolCalls: (toolCalls) => seen.push(toolCalls),
		});

		expect(result.toolCalls).toEqual([
			{
				id: "call-1",
				type: "function",
				function: { name: "co_agent_observe", arguments: '{"scope":"page"}' },
			},
			{
				id: "call-2",
				type: "function",
				function: { name: "web_search", arguments: '{"q":"metro"}' },
			},
		]);
		expect(seen.length).toBeGreaterThan(0);
		// The parts keep the flow in order, which is what the transcript renders.
		expect(result.parts?.map((part) => part.role)).toEqual([
			"assistant",
			"tool",
			"assistant",
			"tool",
			"assistant",
		]);
	});

	it("sends history before the new turn and reminders on their own", async () => {
		runWith([]);
		const history = [
			{ role: "user" as const, content: "earlier question" },
			{ role: "assistant" as const, content: "earlier answer" },
		];

		await embeddedChatService.chatStream({
			messages: [
				{ id: "u", role: "user", content: "now", timestamp: new Date() },
			],
			model: "m",
			mode: "custom",
			history,
			reminders: ["Current page: https://x.test/"],
		});

		const payload = mocks.payloads.at(-1);
		expect(payload?.messages).toEqual([
			...history,
			{ role: "user", content: "now" },
		]);
		expect(payload?.reminders).toEqual(["Current page: https://x.test/"]);
	});
});
