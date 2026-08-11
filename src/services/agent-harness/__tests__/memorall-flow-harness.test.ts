import { beforeEach, describe, expect, it, vi } from "vitest";
import { graphRegistry } from "@/services/flows-legacy/registries/graph-registry";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import {
	MEMORALL_FLOW_GRAPH_ID,
	createMemorallFlowRun,
	getMemorallAgentHarness,
	toLegacyFlowStream,
	type MemorallFlowRunInput,
	type MemorallFlowServices,
} from "../memorall-flow-harness";

vi.mock("@/services/flows-legacy/registries/graph-registry", () => ({
	graphRegistry: { createChatGraph: vi.fn() },
}));

const mockedCreateChatGraph = vi.mocked(graphRegistry.createChatGraph);
const services = {} as MemorallFlowServices;

const makeInput = (
	graphType: string,
	content = graphType,
): MemorallFlowRunInput => ({
	graphType,
	config: { graphType, steps: [] } as UnifiedFlowConfig,
	initialState: {
		messages: [{ role: "user", content }],
		contextQueries: [],
	},
	streamModes: ["custom", "values"],
});

const collect = async (stream: AsyncIterable<unknown>): Promise<unknown[]> => {
	const values: unknown[] = [];
	for await (const value of stream) values.push(value);
	return values;
};

describe("Memorall agent harness composition", () => {
	beforeEach(() => {
		mockedCreateChatGraph.mockReset();
	});

	it("registers only the explicit app-owned compatibility graph", () => {
		const descriptor = getMemorallAgentHarness().inspect();
		expect(descriptor.graphs.map(({ id }) => id)).toEqual([
			MEMORALL_FLOW_GRAPH_ID,
		]);
		expect(descriptor.plugins).toEqual({
			"memorall.flow-compatibility": "1.0.0",
		});
	});

	it.each(["agent", "foundation"])(
		"preserves the stored %s graph ID and translates stream events",
		async (graphType) => {
			mockedCreateChatGraph.mockReturnValue({
				getInitialState: (value: unknown) => value as Record<string, unknown>,
				graph: {
					async *stream() {
						yield [
							"custom",
							{
								type: "actions",
								actions: [{ id: "a", name: graphType, metadata: {} }],
								ignored: undefined,
							},
						];
						yield ["updates", { ignored: true }];
						yield ["values", { response: `${graphType} complete` }];
					},
				} as never,
			});

			const run = createMemorallFlowRun({
				runId: `stored-${graphType}`,
				input: makeInput(graphType),
				services,
			});

			await expect(collect(toLegacyFlowStream(run))).resolves.toEqual([
				[
					"custom",
					{
						type: "actions",
						actions: [{ id: "a", name: graphType, metadata: {} }],
						ignored: null,
					},
				],
				["values", { response: `${graphType} complete` }],
			]);
			expect(mockedCreateChatGraph).toHaveBeenCalledWith(
				graphType,
				services,
				expect.objectContaining({ graphType }),
			);
		},
	);

	it("isolates concurrent flow input and results", async () => {
		mockedCreateChatGraph.mockImplementation((graphType) => ({
			getInitialState: (value: unknown) => value as Record<string, unknown>,
			graph: {
				async *stream() {
					await Promise.resolve();
					yield ["values", { response: graphType }];
				},
			} as never,
		}));

		const first = createMemorallFlowRun({
			runId: "concurrent-agent",
			input: makeInput("agent"),
			services,
		});
		const second = createMemorallFlowRun({
			runId: "concurrent-foundation",
			input: makeInput("foundation"),
			services,
		});

		const [firstEvents, secondEvents] = await Promise.all([
			collect(toLegacyFlowStream(first)),
			collect(toLegacyFlowStream(second)),
		]);
		expect(firstEvents).toEqual([["values", { response: "agent" }]]);
		expect(secondEvents).toEqual([["values", { response: "foundation" }]]);
	});

	it("propagates harness cancellation into the legacy graph signal", async () => {
		let receivedSignal: AbortSignal | undefined;
		mockedCreateChatGraph.mockReturnValue({
			getInitialState: (value: unknown) => value as Record<string, unknown>,
			graph: {
				async *stream(_input: unknown, options: { signal?: AbortSignal }) {
					receivedSignal = options.signal;
					await new Promise<void>((resolve) => {
						if (options.signal?.aborted) resolve();
						options.signal?.addEventListener("abort", () => resolve(), {
							once: true,
						});
					});
					throw options.signal?.reason;
				},
			} as never,
		});

		const run = createMemorallFlowRun({
			runId: "cancelled-flow",
			input: makeInput("agent"),
			services,
		});
		const streamResult = collect(toLegacyFlowStream(run));
		await vi.waitFor(() => expect(receivedSignal).toBeDefined());
		await run.cancel("test cancellation");

		expect(receivedSignal?.aborted).toBe(true);
		await expect(streamResult).rejects.toMatchObject({
			code: "cancelled",
			message: "test cancellation",
		});
	});
});
