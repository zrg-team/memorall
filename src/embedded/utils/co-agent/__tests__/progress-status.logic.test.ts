import { describe, expect, it } from "vitest";
import {
	createToolProgressTracker,
	describeToolName,
	humanizeName,
	latestToolName,
	progressForExecuteStart,
	progressForNode,
	progressForTool,
} from "../progress-status";

const THINKING = "Thinking...";

describe("what the dock says it is doing", () => {
	it("says it is thinking while the model composes", () => {
		// Rather than "agent_completion", which names the machinery.
		for (const node of ["agent", "agent_completion", "chat-completion"]) {
			expect(progressForNode(node, THINKING)).toEqual({
				kind: "thinking",
				label: THINKING,
			});
		}
	});

	it("does not show the tool dispatcher as if it were the work", () => {
		// "tool executor" was what the bubble actually printed, and it says
		// nothing; the tool name arrives a moment later and is the real answer.
		expect(progressForNode("tool_executor", THINKING).label).toBe(THINKING);
	});

	it("names a step it does not recognise, readably", () => {
		expect(progressForNode("retrieve_context", THINKING)).toEqual({
			kind: "step",
			label: "Retrieve context",
		});
	});

	it("falls back to thinking when there is no node at all", () => {
		expect(progressForNode(undefined, THINKING).label).toBe(THINKING);
	});

	it("describes the co-agent's tools in plain language", () => {
		expect(progressForTool("co_agent_observe")).toEqual({
			kind: "tool",
			label: "Reading the page",
		});
		expect(describeToolName("co_agent_move")).toBe("Pointing at the page");
		expect(describeToolName("web_search")).toBe("Searching the web");
	});

	it("humanises a tool it has no wording for", () => {
		expect(describeToolName("some_new_tool")).toBe("Some new tool");
	});

	it("shows the tool that is running now, not the first of the batch", () => {
		expect(
			latestToolName([
				{ function: { name: "co_agent_observe" } },
				{ function: { name: "co_agent_move" } },
			]),
		).toBe("co_agent_move");
	});

	it("skips a trailing call whose name has not streamed in yet", () => {
		// Tool calls arrive in fragments; the last one can be nameless for a tick.
		expect(
			latestToolName([
				{ function: { name: "co_agent_query" } },
				{ function: { name: "" } },
				{},
			]),
		).toBe("co_agent_query");
	});

	it("has nothing to say when no tool has been called", () => {
		expect(latestToolName([])).toBeUndefined();
		expect(latestToolName(undefined)).toBeUndefined();
	});

	it("leaves an empty name empty rather than inventing one", () => {
		expect(humanizeName("   ")).toBe("");
	});

	it("names the tool a tool start is for, not the dispatcher", () => {
		// The dispatcher's start carries the tool; it used to read as Thinking
		// for as long as the tool ran.
		expect(
			progressForExecuteStart(
				{ node: "tool_executor", metadata: { tool: "web_open" } },
				THINKING,
			),
		).toEqual({ kind: "tool", label: "Opening a page" });
		expect(progressForExecuteStart({ node: "web-feature" }, THINKING)).toEqual({
			kind: "step",
			label: "Web feature",
		});
		expect(
			progressForExecuteStart({ node: "agent-completion" }, THINKING).label,
		).toBe(THINKING);
	});

	it("names an MCP tool by its own title", () => {
		expect(
			describeToolName("github__create_issue", {
				source: "mcp",
				mcp: { title: "Create GitHub issue", originalToolName: "create_issue" },
			}),
		).toBe("Create GitHub issue");
		expect(describeToolName("github__create_issue")).toBe("Create issue");
	});

	it("follows tool calls until none is running", () => {
		const follow = createToolProgressTracker(THINKING);
		expect(follow({ id: "a", name: "web_open", status: "running" }).label).toBe(
			"Opening a page",
		);
		expect(follow({ id: "b", name: "web_read", status: "running" }).label).toBe(
			"Reading a page",
		);
		// A progress report from the first call does not take over the status.
		expect(follow({ id: "a", name: "web_open", status: "running" }).label).toBe(
			"Reading a page",
		);
		expect(
			follow({ id: "b", name: "web_read", status: "completed" }).label,
		).toBe("Opening a page");
		expect(follow({ id: "a", name: "web_open", status: "failed" })).toEqual({
			kind: "thinking",
			label: THINKING,
		});
	});
});
