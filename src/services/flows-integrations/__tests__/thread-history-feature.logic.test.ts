import {
	createFlowRuntimeVars,
	withFlowRuntimeVars,
} from "@memorall/agent-harness-flows/context/runtime-context";
import { describe, expect, it } from "vitest";
import {
	createThreadHistoryFeatureStep,
	THREAD_HISTORY_FEATURE_SYSTEM_PROMPT,
	type ThreadHistoryFeatureInput,
} from "@/services/flows-integrations/steps/features/thread-history-feature";
import {
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_READ_TOOL,
	THREAD_HISTORY_SEARCH_TOOL,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";

const input = (): ThreadHistoryFeatureInput => ({
	messages: [{ role: "user", content: "what did we decide?" }],
	tools: ["web_search"],
});

const runConfig = (values?: Record<string, unknown>) =>
	withFlowRuntimeVars({}, createFlowRuntimeVars(values));

const run = async (values?: Record<string, unknown>) => {
	const step = createThreadHistoryFeatureStep({});
	return step.execute(input(), runConfig(values) as never);
};

const splitRuntime = {
	[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: "conversation-1",
	[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]: "separator-1",
};

describe("thread history feature step", () => {
	it("adds nothing when the conversation has not been split", async () => {
		const result = await run();
		const output = (result as { output: Record<string, unknown> }).output;

		expect(output.tools).toEqual(["web_search"]);
		expect(output.messages).toEqual(input().messages);
	});

	it("adds nothing when only the conversation id is present", async () => {
		const result = await run({
			[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: "conversation-1",
		});
		const output = (result as { output: Record<string, unknown> }).output;

		expect(output.tools).toEqual(["web_search"]);
	});

	it("adds both history tools once the run carries a separator", async () => {
		const result = await run(splitRuntime);
		const output = (result as { output: { tools: unknown[] } }).output;

		expect(output.tools).toContain(THREAD_HISTORY_SEARCH_TOOL);
		expect(output.tools).toContain(THREAD_HISTORY_READ_TOOL);
		expect(output.tools).toContain("web_search");
	});

	it("prepends guidance on when to look past the split", async () => {
		const result = await run(splitRuntime);
		const output = (
			result as {
				output: { messages: Array<{ role: string; content: string }> };
			}
		).output;

		expect(output.messages[0].role).toBe("system");
		expect(output.messages[0].content).toContain(
			THREAD_HISTORY_FEATURE_SYSTEM_PROMPT,
		);
		expect(output.messages.at(-1)).toMatchObject({ role: "user" });
	});

	it("passes the input through when the runtime bag is unusable", async () => {
		const step = createThreadHistoryFeatureStep({});
		const result = await step.execute(input(), {
			configurable: {
				__flowRuntimeVars: {
					get() {
						throw new Error("runtime exploded");
					},
				},
			},
		} as never);
		const output = (result as { output: Record<string, unknown> }).output;

		expect(output.tools).toEqual(["web_search"]);
		expect(output.messages).toEqual(input().messages);
	});
});
