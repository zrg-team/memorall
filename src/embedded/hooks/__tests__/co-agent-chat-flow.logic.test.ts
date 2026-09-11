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
