import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	chatStream: vi.fn(async (_options: Record<string, unknown>) => ({
		content: "",
		actions: [],
	})),
}));

vi.mock("@/embedded/chat-service", () => ({
	embeddedChatService: { chatStream: mocks.chatStream },
}));

import {
	coAgentChatService,
	createCoAgentFlowPrefixConfig,
} from "@/embedded/pages/CoAgent/co-agent-chat";
import { CO_AGENT_DEFAULT_FLOW_ID } from "../selected-agent-flow";

const call = (): Record<string, unknown> => {
	const last = mocks.chatStream.mock.calls.at(-1);
	if (!last) throw new Error("The co-agent never called the chat service.");
	return last[0];
};

const run = (agentFlowId?: string) =>
	coAgentChatService.chatStream({
		prompt: "what is this?",
		agentFlowId,
		model: "m",
		pageContext: { url: "https://x.test/", title: "X" },
	});

describe("which agent the co-agent runs", () => {
	it("runs the chosen agent, with the co-agent feature added to it", async () => {
		// The point of picking an agent: its own instructions have to apply, with
		// the co-agent tooling layered on rather than replacing it.
		await run("agent-vi");

		expect(call().agentFlowId).toBe("agent-vi");
		const prefix = call().flowConfigPrefix as {
			steps: Array<{ name: string; enabled: boolean }>;
		};
		expect(prefix.steps).toEqual([
			expect.objectContaining({ name: "co-agent-feature", enabled: true }),
		]);
	});

	it("falls back to the stock agent for the built-in CoAgent entry", async () => {
		// "chat" is the sentinel the pipeline reads as "no saved agent".
		await run(CO_AGENT_DEFAULT_FLOW_ID);

		expect(call().agentFlowId).toBeUndefined();
		expect(call().flowConfigPrefix).toBeDefined();
	});

	it("still enables the co-agent feature when nothing was chosen", async () => {
		await run(undefined);

		expect(call().agentFlowId).toBeUndefined();
		const prefix = call().flowConfigPrefix as { steps: unknown[] };
		expect(prefix.steps).toHaveLength(1);
	});

	it("adds the feature as a step rather than replacing the graph", () => {
		// applyFlowConfigPrefix prepends these to the agent's own steps; the
		// agent's graphType and instructions have to survive.
		const prefix = createCoAgentFlowPrefixConfig();

		expect(prefix.steps).toHaveLength(1);
		expect(prefix.steps[0].name).toBe("co-agent-feature");
		expect(prefix.steps[0].enabled).toBe(true);
	});
});

describe("keeping a co-agent session cacheable", () => {
	it("sends where the user is as reminders, never in the system prompt", async () => {
		// The system prompt is the first thing in the request. A URL or hovered
		// element there changed every question's opening bytes, so no two
		// questions could share a cached prefix.
		await coAgentChatService.chatStream({
			prompt: "what is this?",
			model: "m",
			pageContext: { url: "https://x.test/listing/1", title: "Listing" },
			anchorContext: {
				kind: "hover",
				selector: "#price",
				tagName: "SPAN",
				text: "9,5 tỷ",
				rect: { x: 0, y: 0, width: 10, height: 10 },
				createdAt: 0,
			} as never,
		});

		expect(call().systemMessages).toBeUndefined();
		const reminders = call().reminders as string[];
		expect(reminders).toHaveLength(2);
		expect(reminders[0]).toContain("https://x.test/listing/1");
		expect(reminders[1]).toContain("#price");
	});

	it("carries the session's earlier turns and the conversation to the run", async () => {
		const history = [
			{ role: "user", content: "first question" },
			{ role: "assistant", content: null, tool_calls: [] },
		];
		const conversation = {
			id: "conversation-1",
			inProgressMessage: { id: "assistant-2" },
			historyBoundary: {
				separatorId: "session-start",
				createdAt: "2026-09-17T12:00:00.000Z",
			},
		};

		await coAgentChatService.chatStream({
			prompt: "and the next one?",
			model: "m",
			pageContext: { url: "https://x.test/", title: "X" },
			history: history as never,
			conversation,
		});

		expect(call().history).toEqual(history);
		expect(call().conversation).toEqual(conversation);
		// The question itself still goes last, after what came before it.
		expect(call().messages).toEqual([
			expect.objectContaining({ role: "user", content: "and the next one?" }),
		]);
	});
});
