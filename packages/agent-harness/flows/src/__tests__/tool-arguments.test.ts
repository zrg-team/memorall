import { describe, expect, it, vi } from "vitest";
import { AgentGraph } from "../graph/agent/graph.js";
import {
	findToolArgumentProblem,
	MAX_ARGUMENT_CORRECTIONS,
} from "../graph/agent/tool-arguments.js";
import { jsonToolSchema, type BaseTool } from "../interfaces/engine/tool.js";
import type { AgentState } from "../graph/agent/state.js";

/** Composio's router meta-tool, as its schema reaches the model. */
const routerTool = (execute: BaseTool["execute"] = async () => "ran"): BaseTool => ({
	name: "composio__COMPOSIO_MULTI_EXECUTE_TOOL",
	description: "Execute one or more tools",
	schema: jsonToolSchema({
		type: "object",
		properties: {
			tools: {
				type: "array",
				items: {
					type: "object",
					properties: {
						tool_slug: { type: "string" },
						arguments: { type: "object", additionalProperties: true },
					},
					required: ["tool_slug", "arguments"],
				},
			},
			session_id: { type: "string" },
		},
		required: ["tools"],
	}),
	execute,
});

const plainTool = (execute: BaseTool["execute"] = async () => "ran"): BaseTool => ({
	name: "github__get_repository",
	description: "Get a repository",
	schema: jsonToolSchema({
		type: "object",
		properties: {
			owner: { type: "string", description: "Repository owner" },
			repo: { type: "string", description: "Repository name" },
		},
		required: ["owner", "repo"],
	}),
	execute,
});

describe("findToolArgumentProblem", () => {
	it("catches a routed call whose arguments are empty", () => {
		// The meta-tool's own schema is satisfied — `tools` is present — so nothing
		// short of looking one level down can tell this call is already lost.
		const problem = findToolArgumentProblem(routerTool(), {
			tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: {} }],
			session_id: "pole",
		});

		expect(problem?.target).toBe("GITHUB_GET_A_REPOSITORY");
		expect(problem?.correction).toContain("GITHUB_GET_A_REPOSITORY");
		expect(problem?.correction).toContain("look it up first");
	});

	it("catches a routed call that omits arguments entirely", () => {
		expect(
			findToolArgumentProblem(routerTool(), {
				tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY" }],
			}),
		).toBeDefined();
	});

	it("names the missing fields and the schema for an ordinary tool", () => {
		const problem = findToolArgumentProblem(plainTool(), {});

		expect(problem?.missing).toEqual(["owner", "repo"]);
		expect(problem?.correction).toContain("owner (string), required");
		expect(problem?.correction).toContain("Repository name");
	});

	it("leaves a call that can succeed alone", () => {
		expect(
			findToolArgumentProblem(routerTool(), {
				tools: [
					{
						tool_slug: "GITHUB_GET_A_REPOSITORY",
						arguments: { owner: "zrg-team", repo: "memorall" },
					},
				],
			}),
		).toBeUndefined();

		expect(
			findToolArgumentProblem(plainTool(), { owner: "a", repo: "b" }),
		).toBeUndefined();
	});

	it("does not object to a tool that requires nothing", () => {
		const tool: BaseTool = {
			name: "now",
			description: "current time",
			schema: jsonToolSchema({ type: "object", properties: {} }),
			execute: async () => "ok",
		};

		expect(findToolArgumentProblem(tool, {})).toBeUndefined();
	});
});

const stateWith = (
	tool: BaseTool,
	args: unknown,
	overrides: Partial<AgentState> = {},
): AgentState => ({
	messages: [],
	outputMessages: [
		{
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: tool.name, arguments: JSON.stringify(args) },
				},
			],
		},
	],
	tools: [],
	response: "",
	maxIterations: 10,
	currentIteration: 0,
	...overrides,
});

const graphWith = (tool: BaseTool) =>
	new AgentGraph(
		{
			llm: {
				isReady: () => true,
				getCurrentModel: async () => ({ modelId: "test" }),
				getMaxModelTokens: async () => 128000,
				getMaxResponseTokens: async () => 4096,
				chatCompletions: () => {
					throw new Error("the model is not called by tool-node tests");
				},
			},
		},
		{ tools: [tool] },
	);

describe("AgentGraph tool executor", () => {
	it("answers an empty routed call with the schema instead of dispatching it", async () => {
		const execute = vi.fn(async () => "ran");
		const tool = routerTool(execute);

		const result = await graphWith(tool).toolsNode(
			stateWith(tool, {
				tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: {} }],
			}),
		);

		expect(execute).not.toHaveBeenCalled();
		expect(result.outputMessages?.at(-1)?.content).toContain(
			"GITHUB_GET_A_REPOSITORY",
		);
		// A call that never ran is not a tool failure; counting it would spend the
		// model's retries on the loop this exists to break.
		expect(result.toolFailureStreak).toBeNull();
		expect(result.argumentCorrections).toEqual({ [tool.name]: 1 });
	});

	it("dispatches the corrected call the model sends next", async () => {
		const execute = vi.fn(async () => "ran");
		const tool = routerTool(execute);
		const graph = graphWith(tool);

		const first = await graph.toolsNode(
			stateWith(tool, {
				tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: {} }],
			}),
		);
		await graph.toolsNode(
			stateWith(
				tool,
				{
					tools: [
						{
							tool_slug: "GITHUB_GET_A_REPOSITORY",
							arguments: { owner: "zrg-team", repo: "memorall" },
						},
					],
				},
				{ argumentCorrections: first.argumentCorrections },
			),
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0][0]).toEqual({
			tools: [
				{
					tool_slug: "GITHUB_GET_A_REPOSITORY",
					arguments: { owner: "zrg-team", repo: "memorall" },
				},
			],
		});
	});

	it("stops correcting and lets the real call through once the model ignores it", async () => {
		// A model that has been handed the schema twice and still sends nothing is
		// better served by the server's own error than a third copy of ours.
		const execute = vi.fn(async () => "ran");
		const tool = routerTool(execute);

		const result = await graphWith(tool).toolsNode(
			stateWith(
				tool,
				{ tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: {} }] },
				{ argumentCorrections: { [tool.name]: MAX_ARGUMENT_CORRECTIONS } },
			),
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(result.outputMessages?.at(-1)?.content).toBe("ran");
	});
});
