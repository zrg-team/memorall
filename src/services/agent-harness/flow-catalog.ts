import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	getFlowRuntimeVars,
	withFlowRuntimeVars,
} from "@memorall/agent-harness-flows/context/runtime-context";
import type { IFlowCatalogService } from "@memorall/agent-harness-flows/interfaces/services/flow-catalog";
import { mergeWithDefaultConfig } from "@memorall/agent-harness-flows/utils/flow-config";
import {
	AGENT_RUNTIME_KEY,
	CONVERSATION_RUNTIME_KEY,
	RUN_RUNTIME_KEY,
} from "@/services/chat/runtime-keys";
import type { FlowBuilderService } from "@/services/flow-builder-service";
import { withResolvedConnections } from "@/services/mcp-connections";
import {
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";
import { applyMemonAbsorption } from "@/services/memon/feature-config";

/** Saved agents and their execution settings, including delegated MemonOS runs. */
export const createMemorallFlowCatalog = (
	service: Pick<
		FlowBuilderService,
		"listPredefinedFlows" | "getUnifiedFlowConfig"
	>,
): IFlowCatalogService => ({
	listFlows: async (groupKey) =>
		groupKey === "foundation"
			? (await service.listPredefinedFlows(groupKey)).map(
					({ id, name, description }) => ({ id, name, description }),
				)
			: [],
	getFlowConfig: async (ref) => {
		const config = await service.getUnifiedFlowConfig(ref);
		return withResolvedConnections(
			applyMemonAbsorption(mergeWithDefaultConfig(config, config.graphType)),
		);
	},
	getRunConfig: ({ flowId }, parentConfig?: LangGraphRunnableConfig) => {
		const parent = getFlowRuntimeVars(parentConfig);
		const conversationId = parent?.get(CONVERSATION_RUNTIME_KEY);
		// Each child has its own computer and prompt files. Never share the
		// parent's mutable runtime vars, computer home or user-message inbox.
		return withFlowRuntimeVars(
			{ signal: parentConfig?.signal },
			{
				[AGENT_RUNTIME_KEY]: flowId,
				[CONVERSATION_RUNTIME_KEY]: conversationId
					? `${conversationId}:agent:${flowId}`
					: undefined,
				[RUN_RUNTIME_KEY]: `${parent?.get(RUN_RUNTIME_KEY) ?? "delegate"}:agent:${flowId}`,
				[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: parent?.get(
					THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
				),
				[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]: parent?.get(
					THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
				),
			},
		);
	},
});
