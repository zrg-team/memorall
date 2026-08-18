import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	GraphBase,
	type BaseStateBase,
} from "@/services/flows-core/graph/graph.base";
import type { BaseGraph } from "@/services/flows-core/registries/graph-registry";
import type { ChatCompletionChunk } from "@/services/flows-core/interfaces/engine/messages";
import { FEATURE_SLOT } from "@/services/flows-core/registries/graph-registry";
import { AgentGraph } from "@/services/flows-core/graph/agent/graph";
import {
	createFlowRegistries,
	finalizeFlowRegistries,
	type FlowRegistrySet,
} from "@/services/flows-core/registries/registry-set";
import { createFlowEngine } from "@/services/flows-core/runtime/flow-engine";
import type { BaseTool } from "@/services/flows-core/interfaces/engine/tool";
import type { BoundStep } from "@/services/flows-core/interfaces/engine/step";
import type { RegisteredStep } from "@/services/flows-core/registries/step-registry";
import { buildDefaultFlowConfig } from "@/services/flows-core/utils/flow-config";

class RegistryTestGraph extends GraphBase<string, BaseStateBase, unknown> {
	constructor() {
		super({}, createFlowRegistries());
	}

	invoke(
		..._args: Parameters<BaseGraph["invoke"]>
	): ReturnType<BaseGraph["invoke"]> {
		return Promise.resolve({}) as ReturnType<BaseGraph["invoke"]>;
	}

	stream(
		..._args: Parameters<BaseGraph["stream"]>
	): ReturnType<BaseGraph["stream"]> {
		return Promise.resolve(
			(async function* () {
				yield {};
			})(),
		) as ReturnType<BaseGraph["stream"]>;
	}

	getGraph(): ReturnType<BaseGraph["getGraph"]> {
		return {} as ReturnType<BaseGraph["getGraph"]>;
	}
}

const fakeGraph = (): BaseGraph => new RegistryTestGraph();

const fakeTool = (name: string): BaseTool => ({
	name,
	description: `${name} tool`,
	schema: z.object({}),
	execute: async () => `${name} result`,
});

const stepEntry = (
	name: string,
	config: RegisteredStep["config"] = {},
): RegisteredStep => {
	const step: BoundStep<unknown, unknown> = {
		name,
		execute: async (input) => ({ output: input }),
		toNode: () => async () => ({}),
	};
	return {
		id: name,
		name,
		factory: () => step,
		config,
	};
};

describe("flow registry sets", () => {
	it("can be finalized to reject runtime mutations", () => {
		const registries = finalizeFlowRegistries(createFlowRegistries());

		expect(registries.services.isFinalized()).toBe(true);
		expect(registries.tools.isFinalized()).toBe(true);
		expect(registries.steps.isFinalized()).toBe(true);
		expect(registries.graphs.isFinalized()).toBe(true);
		expect(() => registries.services.registerSchema("late")).toThrow(
			"after finalization",
		);
		expect(() =>
			registries.tools.setEntry({
				id: "late_tool",
				name: "late_tool",
				factory: () => fakeTool("late_tool"),
				config: {},
				metadata: {},
			}),
		).toThrow("after finalization");
		expect(() => registries.steps.setEntry(stepEntry("late_step"))).toThrow(
			"after finalization",
		);
		expect(() =>
			registries.graphs.setEntry({
				id: "late_graph",
				name: "late_graph",
				factory: () => fakeGraph(),
				config: { stepOrder: [] },
				metadata: {},
			}),
		).toThrow("after finalization");
	});

	it("forks finalized registries into mutable registry copies", () => {
		const source = createFlowRegistries();
		source.tools.setEntry({
			id: "base_tool",
			name: "base_tool",
			factory: () => fakeTool("base_tool"),
			config: {},
			metadata: {},
		});
		finalizeFlowRegistries(source);

		const engine = createFlowEngine({ source });

		expect(engine.registries.tools.isFinalized()).toBe(false);
		expect(() =>
			engine.registries.tools.setEntry({
				id: "new_tool",
				name: "new_tool",
				factory: () => fakeTool("new_tool"),
				config: {},
				metadata: {},
			}),
		).not.toThrow();
	});

	it("uses custom registries when creating graph instances", () => {
		const registries = createFlowRegistries();
		let capturedRegistries: FlowRegistrySet | undefined;

		registries.graphs.setEntry({
			id: "custom",
			name: "custom",
			factory: (_services, _config, context) => {
				capturedRegistries = context?.registries;
				return fakeGraph();
			},
			config: { stepOrder: [] },
			metadata: {},
		});

		const engine = createFlowEngine({ registries });
		const graph = engine.createGraph(
			"custom" as keyof GraphTypeRegistry,
			{} as never,
		);

		expect(graph.raw).toBeDefined();
		expect(capturedRegistries).toBe(registries);
	});

	it("filters registries and removes unavailable tools from configs", () => {
		const source = createFlowRegistries();
		source.tools.setEntry({
			id: "allowed_tool",
			name: "allowed_tool",
			factory: () => fakeTool("allowed_tool"),
			config: {},
			metadata: {},
		});
		source.tools.setEntry({
			id: "blocked_tool",
			name: "blocked_tool",
			factory: () => fakeTool("blocked_tool"),
			config: {},
			metadata: {},
		});
		source.steps.setEntry(stepEntry("kept_step"));
		source.steps.setEntry(stepEntry("dropped_step"));

		const engine = createFlowEngine({
			source,
			filters: {
				tools: (entry) => entry.id === "allowed_tool",
				steps: (entry) => entry.id === "kept_step",
			},
		});

		const filtered = engine.filterConfig({
			graphType: "custom",
			steps: [
				{
					id: "one",
					name: "kept_step",
					enabled: true,
					config: {
						tools: [
							"allowed_tool",
							"blocked_tool",
							{ name: "allowed_tool", config: { mode: "configured" } },
							{ name: "blocked_tool", config: { mode: "configured" } },
						],
					},
				},
				{ id: "two", name: "dropped_step", enabled: true },
			],
		});

		expect(filtered.steps).toHaveLength(1);
		expect(filtered.steps[0].config?.tools).toEqual([
			"allowed_tool",
			{ name: "allowed_tool", config: { mode: "configured" } },
		]);
	});

	it("runs a custom agent graph with fake streamed LLM tool calls", async () => {
		const registries = createFlowRegistries();
		const echoSchema = z.object({ value: z.string() });
		const echoTool: BaseTool = {
			name: "echo_tool",
			description: "Echoes a value",
			schema: echoSchema,
			execute: async (input) => {
				const { value } = echoSchema.parse(input);
				return `echo:${value}`;
			},
		};
		const llmCalls: unknown[] = [];
		const llm = {
			isReady: () => true,
			getCurrentModel: async () => ({ modelId: "test-model" }),
			getMaxModelTokens: async () => 4096,
			getMaxResponseTokens: async () => 1024,
			chatCompletions: (request: unknown) => {
				llmCalls.push(request);
				if (llmCalls.length === 1) {
					return (async function* () {
						const nameStartChunk: ChatCompletionChunk = {
							choices: [
								{
									delta: {
										tool_calls: [
											{
												index: 0,
												id: "call_echo",
												type: "function",
												function: {
													name: "echo",
													arguments: '{"value":',
												},
											},
										],
									},
									finish_reason: null,
									index: 0,
								},
							],
							id: "chunk_1",
							object: "chat.completion.chunk",
							created: 1,
							model: "test-model",
						};
						yield nameStartChunk;

						const nameEndChunk: ChatCompletionChunk = {
							choices: [
								{
									delta: {
										tool_calls: [
											{
												index: 0,
												function: {
													name: "_tool",
													arguments: '"ok"}',
												},
											},
										],
									},
									finish_reason: "tool_calls",
									index: 0,
								},
							],
							id: "chunk_2",
							object: "chat.completion.chunk",
							created: 1,
							model: "test-model",
						};
						yield nameEndChunk;
					})();
				}

				return (async function* () {
					const finalChunk: ChatCompletionChunk = {
						choices: [
							{
								delta: { content: "done" },
								finish_reason: "stop",
								index: 0,
							},
						],
						id: "chunk_3",
						object: "chat.completion.chunk",
						created: 1,
						model: "test-model",
					};
					yield finalChunk;
				})();
			},
		};

		registries.graphs.register(
			"agent-test",
			(services, config, context) =>
				new AgentGraph(services, config, context?.registries),
			{ stepOrder: [] },
		);

		const graph = createFlowEngine({ registries }).createGraph(
			"agent-test",
			{ llm },
			{ tools: [echoTool] },
		);

		const result = await graph.invoke({
			messages: [{ role: "user", content: "Use the echo tool" }],
			outputMessages: [],
			tools: [],
			maxIterations: 4,
			currentIteration: 0,
		});

		expect(llmCalls).toHaveLength(2);
		expect(result.response).toBe("done");
		expect(result.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "tool",
					content: "echo:ok",
					tool_call_id: "call_echo",
				}),
			]),
		);
	});
});

declare global {
	interface GraphTypeRegistry {
		"agent-test": {
			services: ConstructorParameters<typeof AgentGraph>[0];
			config: ConstructorParameters<typeof AgentGraph>[1];
			graph: AgentGraph;
		};
	}
}

describe("flow config merging", () => {
	it("builds graph defaults through feature slots and overlays saved config", () => {
		const registries = createFlowRegistries();
		registries.graphs.setEntry({
			id: "merge-graph",
			name: "merge-graph",
			factory: () => fakeGraph(),
			config: {
				stepOrder: ["add-system", FEATURE_SLOT, "final"],
				stepDefaults: {
					"add-system": { content: "default system" },
				},
			},
			metadata: {},
		});
		registries.steps.setEntry(
			stepEntry("add-system", { enabledByDefault: true }),
		);
		registries.steps.setEntry(
			stepEntry("feature-step", {
				enabledByDefault: false,
				feature: { type: "feature", graphTypes: ["merge-graph"] },
			}),
		);
		registries.steps.setEntry(
			stepEntry("other-feature", {
				enabledByDefault: false,
				feature: { type: "feature", graphTypes: ["other-graph"] },
			}),
		);
		registries.steps.setEntry(stepEntry("final", { enabledByDefault: true }));

		const defaults = buildDefaultFlowConfig("merge-graph", registries);
		expect(defaults.steps.map((step) => step.name)).toEqual([
			"add-system",
			"feature-step",
			"final",
		]);
		expect(defaults.steps[0].config).toEqual({ content: "default system" });

		const engine = createFlowEngine({ registries });
		const merged = engine.mergeWithDefaultConfig(
			{
				graphType: "merge-graph",
				steps: [
					{
						id: "saved-add",
						name: "add-system",
						enabled: false,
						config: { content: "saved system" },
					},
					{
						id: "saved-missing",
						name: "missing-step",
						enabled: true,
					},
					{
						id: "saved-feature",
						name: "feature-step",
						enabled: true,
						config: {
							flag: true,
							tools: ["allowed_tool", "blocked_tool"],
						},
					},
				],
			},
			"merge-graph",
		);

		expect(merged.steps.map((step) => step.name)).toEqual([
			"add-system",
			"feature-step",
			"final",
		]);
		expect(merged.steps[0]).toMatchObject({
			name: "add-system",
			enabled: false,
			config: { content: "saved system" },
		});
		expect(merged.steps[1]).toMatchObject({
			name: "feature-step",
			enabled: true,
			config: {
				flag: true,
				tools: [],
			},
		});
	});

	it("filters feature config tools during merge when only some tools are available", () => {
		const registries = createFlowRegistries();
		registries.graphs.setEntry({
			id: "filtered-feature-graph",
			name: "filtered-feature-graph",
			factory: () => fakeGraph(),
			config: { stepOrder: [FEATURE_SLOT] },
			metadata: {},
		});
		registries.steps.setEntry(
			stepEntry("feature-with-tools", {
				feature: { type: "feature", graphTypes: ["filtered-feature-graph"] },
			}),
		);
		registries.tools.setEntry({
			id: "allowed_tool",
			name: "allowed_tool",
			factory: () => fakeTool("allowed_tool"),
			config: {},
			metadata: {},
		});

		const merged = createFlowEngine({ registries }).mergeWithDefaultConfig(
			{
				graphType: "filtered-feature-graph",
				steps: [
					{
						id: "feature",
						name: "feature-with-tools",
						enabled: true,
						config: {
							tools: [
								"allowed_tool",
								"blocked_tool",
								{ name: "allowed_tool", config: { safe: true } },
								{ name: "blocked_tool", config: { safe: false } },
							],
						},
					},
				],
			},
			"filtered-feature-graph",
		);

		expect(merged.steps[0].config?.tools).toEqual([
			"allowed_tool",
			{ name: "allowed_tool", config: { safe: true } },
		]);
	});
});
