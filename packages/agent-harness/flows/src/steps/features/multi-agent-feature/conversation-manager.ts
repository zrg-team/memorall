import { graphRegistry } from "../../../registries/graph-registry.js";
import type { UnifiedFlowConfig } from "../../../interfaces/config/flow-config.js";
import type { AllServices } from "../../../interfaces/services/services.js";
import { normalizeLangGraphStreamChunk } from "../../../utils/langgraph-stream.js";
import type { ChatCompletionMessageParam } from "../../../interfaces/engine/messages.js";
import { logInfo, logWarn } from "../../../utils/logger.js";
import type { FlowRegistrySet } from "../../../registries/registry-set.js";

export interface MultiAgentChildAgent {
	id: string;
	name: string;
	description?: string | null;
}

export interface MultiAgentManagerConfig {
	childAgents: MultiAgentChildAgent[];
	topicId?: string;
	services: AllServices;
	/**
	 * Optional: provide topic context queries for child agents.
	 * When flows-memory is active, pass a loader that reads topic descriptions
	 * from the knowledge database so child agents have richer context.
	 */
	getContextQueries?: (topicId?: string) => Promise<string[]>;
	registries?: FlowRegistrySet;
}

export interface ChildAgentMessageResult {
	childAgent: MultiAgentChildAgent;
	response: string;
	historyLength: number;
}

// "agent" graph works with zero steps — it has hardcoded nodes and won't throw.
// "foundation" with steps:[] throws in FoundationFlow constructor.
const FALLBACK_CHILD_FLOW_CONFIG: UnifiedFlowConfig = {
	graphType: "agent",
	steps: [],
};

const cloneFlowConfig = (config: UnifiedFlowConfig): UnifiedFlowConfig => ({
	...config,
	steps: config.steps.map((step) => ({
		...step,
		config: step.config ? { ...step.config } : undefined,
	})),
});

const stripMultiAgentFeature = (
	config: UnifiedFlowConfig,
): UnifiedFlowConfig => ({
	...config,
	steps: config.steps.map((step) =>
		step.name === "multi-agent-feature" ? { ...step, enabled: false } : step,
	),
});

export class MultiAgentManager {
	private readonly childAgentMap: Map<string, MultiAgentChildAgent>;
	private readonly histories = new Map<string, ChatCompletionMessageParam[]>();

	constructor(private readonly config: MultiAgentManagerConfig) {
		this.childAgentMap = new Map(
			config.childAgents.map((agent) => [agent.id, agent]),
		);
	}

	static fromFeatureInput(
		input: Pick<ChatCompletionMessageParamContainer, "topicId">,
		childAgents: MultiAgentChildAgent[],
		services: AllServices,
		registries?: FlowRegistrySet,
	): MultiAgentManager {
		return new MultiAgentManager({
			childAgents,
			topicId: input.topicId,
			services,
			registries,
		});
	}

	get childAgents(): MultiAgentChildAgent[] {
		return this.config.childAgents;
	}

	get topicId(): string | undefined {
		return this.config.topicId;
	}

	getChildAgent(agentId: string): MultiAgentChildAgent | undefined {
		return this.childAgentMap.get(agentId);
	}

	async sendMessage(
		agentId: string,
		message: string,
	): Promise<ChildAgentMessageResult> {
		const childAgent = this.getChildAgent(agentId);
		if (!childAgent) {
			throw new Error(
				`Agent '${agentId}' is not in the selected child-agent list.`,
			);
		}

		const history = this.histories.get(agentId) ?? [];
		const nextHistory = [...history];
		nextHistory.push({
			role: "user",
			content: message,
		});

		const response =
			(await this.executeChildFlow(agentId, nextHistory)).trim() ||
			"No response returned.";
		nextHistory.push({
			role: "assistant",
			content: response,
		});

		this.histories.set(agentId, nextHistory);

		return {
			childAgent,
			response,
			historyLength: nextHistory.length,
		};
	}

	dispose(): void {
		this.histories.clear();
	}

	private async executeChildFlow(
		agentId: string,
		messages: ChatCompletionMessageParam[],
	): Promise<string> {
		let flowConfig: UnifiedFlowConfig;
		try {
			const catalog = this.config.services.flowCatalog;
			if (!catalog) throw new Error("flowCatalog not available");
			flowConfig = await catalog.getFlowConfig({ flowId: agentId });
		} catch {
			logWarn(
				`[MULTI_AGENT] Failed to load child flow config for ${agentId}, using fallback config`,
			);
			flowConfig = FALLBACK_CHILD_FLOW_CONFIG;
		}

		const resolvedConfig = stripMultiAgentFeature(cloneFlowConfig(flowConfig));
		const graphType = resolvedConfig.graphType ?? "foundation";
		logInfo(
			`[MULTI_AGENT] Executing child agent ${agentId} with graph ${graphType} and steps: [${resolvedConfig.steps
				.filter((step) => step.enabled)
				.map((step) => step.name)
				.join(", ")}]`,
		);
		const contextQueries = this.config.getContextQueries
			? await this.config.getContextQueries(this.config.topicId)
			: [];
		const graphRegistries = this.config.registries;
		const { graph, getInitialState } = (
			graphRegistries?.graphs ?? graphRegistry
		).createChatGraph(
			graphType,
			this.config.services,
			resolvedConfig,
			graphRegistries ? { registries: graphRegistries } : undefined,
		);

		const stream = await graph.stream(
			getInitialState({
				messages,
				topicId: this.config.topicId,
				contextQueries,
			}),
			{ streamMode: ["values"] },
		);

		let content = "";

		for await (const partial of stream) {
			const { mode, payload } = normalizeLangGraphStreamChunk(partial);
			if (mode !== "values") {
				continue;
			}

			const stateValues = payload as Record<string, unknown>;
			if (typeof stateValues.response === "string") {
				content = stateValues.response;
			}
		}

		return content;
	}
}

interface ChatCompletionMessageParamContainer {
	topicId?: string;
}
