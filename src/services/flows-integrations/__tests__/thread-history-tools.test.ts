import { describe, expect, it, vi } from "vitest";
import { createFlowRuntimeVars } from "@memorall/agent-harness-flows/runtime/runtime-context";
import {
	createThreadHistoryReadTool,
	createThreadHistorySearchTool,
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";

const context = () => ({
	state: {},
	runtime: createFlowRuntimeVars({
		[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: "conversation-1",
		[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]: "separator-1",
	}),
});

const row = (overrides: Record<string, unknown> = {}) => ({
	messageId: "message-1",
	role: "assistant",
	content: "alpha\nbefore\nmatched phrase\nafter\nomega",
	parts: null,
	complexContent: null,
	metadata: {},
	createdAt: "2026-08-12T00:00:00.000Z",
	...overrides,
});

describe("thread history tools", () => {
	it("returns matched message IDs with line-based prefix and suffix context", async () => {
		const raw = vi.fn().mockResolvedValue([row()]);
		const tool = createThreadHistorySearchTool({ database: { raw } } as never);
		const result = await tool.execute(
			{ query: "matched phrase", prefixLines: 1, suffixLines: 1 },
			context(),
		);

		expect(result).not.toMatchObject({ isError: true });
		expect((result as { content: string }).content).toContain(
			"messageId: message-1",
		);
		expect((result as { content: string }).content).toContain(
			"L3> matched phrase",
		);
		expect((result as { content: string }).content).toContain("L2| before");
		expect((result as { content: string }).content).toContain("L4| after");
		expect(raw).toHaveBeenCalledWith(
			expect.stringContaining("m.created_at < boundary.created_at"),
			["conversation-1", "separator-1", "matched phrase", 32],
		);
	});

	it("reads the same inclusive line range from multiple IDs in requested order", async () => {
		const raw = vi
			.fn()
			.mockResolvedValue([
				row({ messageId: "message-2", content: "two-a\ntwo-b\ntwo-c" }),
				row({ messageId: "message-1", content: "one-a\none-b\none-c" }),
			]);
		const tool = createThreadHistoryReadTool({ database: { raw } } as never);
		const result = await tool.execute(
			{
				messageIds: ["message-1", "message-2"],
				fromLine: 2,
				toLine: 3,
			},
			context(),
		);
		const content = (result as { content: string }).content;

		expect(content.indexOf("messageId: message-1")).toBeLessThan(
			content.indexOf("messageId: message-2"),
		);
		expect(content).toContain("L2| one-b");
		expect(content).toContain("L3| one-c");
		expect(content).not.toContain("one-a");
		expect(content).toContain("L2| two-b");
	});

	it("rejects execution without trusted thread scope", async () => {
		const tool = createThreadHistorySearchTool({
			database: { raw: vi.fn() },
		} as never);
		const result = await tool.execute({ query: "anything" }, { state: {} });
		expect(result).toMatchObject({ isError: true });
		expect((result as { content: string }).content).toContain(
			"Earlier thread history is not available",
		);
	});
});
