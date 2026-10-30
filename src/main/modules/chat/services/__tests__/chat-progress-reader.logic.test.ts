import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: { execute: vi.fn() },
}));

import type { JobProgressEvent } from "@/services/background-jobs/handlers/types";
import { ChatProgressReader } from "../chat-service";

const event = (result: unknown, status = "processing"): JobProgressEvent =>
	({ stage: "", progress: 50, status, result }) as JobProgressEvent;

const chunk = (delta: Record<string, unknown>) =>
	event({
		type: "chunk",
		chunk: {
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "m",
			choices: [{ index: 0, delta, finish_reason: null }],
		},
	});

describe("reading a chat run's progress", () => {
	it("builds the reply from chunks and passes on steps and tools", () => {
		const onContent = vi.fn();
		const onParts = vi.fn();
		const onExecuteStart = vi.fn();
		const onToolExecution = vi.fn();
		const onUsage = vi.fn();
		const reader = new ChatProgressReader({
			onContent,
			onParts,
			onExecuteStart,
			onToolExecution,
			onUsage,
		});

		expect(
			reader.read(event({ type: "run-started", run: { jobId: "j" } })),
		).toBe(true);
		reader.read(chunk({ role: "assistant", content: "Hel" }));
		reader.read(chunk({ content: "lo" }));
		reader.read(
			event({
				type: "execute-start",
				node: "tool_executor",
				metadata: { tool: "web_open" },
			}),
		);
		const execution = { id: "t1", name: "web_open", status: "running" };
		reader.read(event({ type: "tool-execution", execution }));
		reader.read(event({ type: "usage", usage: { totalTokens: 5 } }));

		expect(onContent).toHaveBeenLastCalledWith("Hello");
		expect(reader.content).toBe("Hello");
		expect(onParts).toHaveBeenCalled();
		expect(onExecuteStart).toHaveBeenCalledWith({
			node: "tool_executor",
			metadata: { tool: "web_open" },
		});
		expect(onToolExecution).toHaveBeenCalledWith(execution);
		expect(onUsage).toHaveBeenCalledWith({ totalTokens: 5 });
	});

	it("takes the final reply over what streamed", () => {
		const onAction = vi.fn();
		const reader = new ChatProgressReader({ onAction });
		reader.read(chunk({ role: "assistant", content: "draft" }));
		reader.read(
			event({
				type: "final",
				content: "Final answer [1]",
				metadata: {
					actions: [{ id: "a", name: "n", description: "d", metadata: {} }],
					tool_calls: [
						{
							id: "call-1",
							type: "function",
							function: { name: "web_open", arguments: "{}" },
						},
					],
				},
			}),
		);

		expect(reader.content).toBe("Final answer [1]");
		expect(reader.actions.map((action) => action.id)).toEqual(["a"]);
		expect(reader.toolCalls?.[0]?.function.name).toBe("web_open");
		expect(onAction).toHaveBeenCalled();
	});

	it("reads the completed result's final reply", () => {
		const reader = new ChatProgressReader();
		reader.read(
			event(
				{ type: "final", content: "Done", metadata: { usage: { total: 1 } } },
				"completed",
			),
		);
		expect(reader.content).toBe("Done");
		expect(reader.usage).toEqual({ total: 1 });
	});

	it("stops at a failure and says why", () => {
		const onError = vi.fn();
		const reader = new ChatProgressReader({ onError });
		const failed = {
			stage: "",
			progress: 100,
			status: "failed",
			error: "Rate limited",
		} as JobProgressEvent;

		expect(reader.read(failed)).toBe(false);
		expect(reader.failed).toBe(true);
		expect(reader.error).toBe("Rate limited");
		expect(onError).toHaveBeenCalledWith("Rate limited");
	});
});
