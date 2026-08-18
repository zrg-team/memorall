import {
	assertJsonValue,
	createHarness,
	createServiceToken,
	type AgentHarness,
	type HarnessPlugin,
	type HarnessRun,
	type JsonValue,
} from "@memorall/agent-harness-core";
import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import type { ChatMessage } from "@/types/openai";
import type { UnifiedFlowConfig } from "@/services/flows-core/interfaces/config/flow-config";
import { graphRegistry } from "@/services/flows-core/registries/graph-registry";
import {
	createFlowRuntimeVars,
	withFlowRuntimeVars,
} from "@/services/flows-core/runtime/runtime-context";
import { normalizeLangGraphStreamChunk } from "@/services/flows-core/utils/langgraph-stream";
import { sanitizeForJson } from "@/utils/sanitize-json";

export const MEMORALL_FLOW_GRAPH_ID = "memorall.compatibility-flow";
const LEGACY_CUSTOM_CHANNEL = "memorall.legacy.custom";

export type MemorallFlowServices = Parameters<
	typeof graphRegistry.createChatGraph
>[1];

export interface MemorallFlowRunInput {
	readonly graphType: string;
	readonly config: UnifiedFlowConfig;
	readonly initialState: {
		readonly messages: ChatMessage[];
		readonly topicId?: string;
		readonly contextQueries: string[];
	};
	readonly streamModes: readonly ("custom" | "updates" | "values")[];
	readonly runtimeVars?: Readonly<Record<string, unknown>>;
}

export const MEMORALL_FLOW_SERVICES = createServiceToken<MemorallFlowServices>(
	"memorall.flow-services",
	{
		description: "Memorall-owned legacy flow service bindings",
	},
);

const asJsonValue = (value: unknown, label: string): JsonValue => {
	const sanitized = sanitizeForJson(value);
	assertJsonValue(sanitized, label);
	return sanitized;
};

const isMemorallFlowRunInput = (
	value: unknown,
): value is MemorallFlowRunInput => {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<MemorallFlowRunInput>;
	return (
		typeof candidate.graphType === "string" &&
		!!candidate.config &&
		typeof candidate.config === "object" &&
		!!candidate.initialState &&
		typeof candidate.initialState === "object" &&
		Array.isArray(candidate.initialState.messages) &&
		Array.isArray(candidate.initialState.contextQueries) &&
		Array.isArray(candidate.streamModes)
	);
};

export const memorallFlowCompatibilityPlugin = (): HarnessPlugin => ({
	id: "memorall.flow-compatibility",
	version: "1.0.0",
	register(registrar) {
		registrar.requireService(MEMORALL_FLOW_SERVICES);
		registrar.registerGraph({
			id: MEMORALL_FLOW_GRAPH_ID,
			version: "1.0.0",
			description:
				"App-owned bridge for stored Memorall flow IDs during harness migration",
			requiredServices: [MEMORALL_FLOW_SERVICES],
			async execute(context) {
				if (!isMemorallFlowRunInput(context.input)) {
					throw new TypeError("Invalid Memorall compatibility flow input");
				}

				const input = context.input;
				const services = context.services.get(MEMORALL_FLOW_SERVICES);
				const { graph, getInitialState } = graphRegistry.createChatGraph(
					input.graphType,
					services,
					input.config,
				);
				const runtimeVars = createFlowRuntimeVars(
					input.runtimeVars ? { ...input.runtimeVars } : undefined,
				);
				const stream = await graph.stream(
					getInitialState(input.initialState),
					withFlowRuntimeVars(
						{
							streamMode: [...input.streamModes],
							signal: context.signal,
						},
						runtimeVars,
					),
				);

				let finalState: JsonValue = null;
				for await (const partial of stream) {
					const { mode, payload } = normalizeLangGraphStreamChunk(partial);
					if (mode === "custom") {
						await context.events.emit({
							type: "model.delta",
							runId: context.runId,
							delta: {
								channel: LEGACY_CUSTOM_CHANNEL,
								payload: asJsonValue(payload, "Legacy flow custom event"),
							},
							timestamp: context.platform.now(),
						});
					} else if (mode === "values") {
						finalState = asJsonValue(payload, "Legacy flow final state");
					}
				}

				return { output: finalState };
			},
		});
	},
});

let harness: AgentHarness | undefined;

export const getMemorallAgentHarness = (): AgentHarness => {
	harness ??= createHarness({
		platform: createBrowserPlatform({ runtime: "extension-worker" }),
		plugins: [memorallFlowCompatibilityPlugin()],
	});
	return harness;
};

export interface CreateMemorallFlowRunOptions {
	readonly runId: string;
	readonly input: MemorallFlowRunInput;
	readonly services: MemorallFlowServices;
	readonly signal?: AbortSignal;
}

export const createMemorallFlowRun = ({
	runId,
	input,
	services,
	signal,
}: CreateMemorallFlowRunOptions): HarnessRun =>
	getMemorallAgentHarness().run({
		runId,
		graph: MEMORALL_FLOW_GRAPH_ID,
		input,
		services: { [MEMORALL_FLOW_SERVICES.id]: services },
		signal,
	});

export async function* toLegacyFlowStream(
	run: HarnessRun,
): AsyncGenerator<unknown, void, void> {
	for await (const event of run) {
		if (
			event.type === "model.delta" &&
			!!event.delta &&
			typeof event.delta === "object" &&
			!Array.isArray(event.delta)
		) {
			const delta = event.delta as Readonly<Record<string, JsonValue>>;
			if (delta.channel === LEGACY_CUSTOM_CHANNEL && "payload" in delta) {
				yield ["custom", delta.payload];
			}
		} else if (event.type === "run.completed") {
			yield ["values", event.result];
		}
	}
	await run.result();
}
