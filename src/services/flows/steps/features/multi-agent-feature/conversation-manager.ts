import { getKnowledgeDatabase } from "../../../interfaces/knowledge";
import { sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import { chatFlowRegistry } from "../../../chat-flow-registry";
import type { UnifiedFlowConfig } from "../../../interfaces/flow-config";
import type { AllServices } from "../../../interfaces/tool";
import { normalizeLangGraphStreamChunk } from "../../../utils/langgraph-stream";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import { logInfo, logWarn } from "../../../interfaces/logger";

export interface MultiAgentChildAgent {
	id: string;
	name: string;
	description?: string | null;
}

export interface MultiAgentManagerConfig {
	childAgents: MultiAgentChildAgent[];
	topicId?: string;
	services: AllServices;
}

export interface ChildAgentMessageResult {
	childAgent: MultiAgentChildAgent;
	response: string;
	historyLength: number;
}

const FALLBACK_CHILD_FLOW_CONFIG: UnifiedFlowConfig = {
	graphType: "foundation",
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

const loadTopicContextQueries = async (
	database: AllServices["database"],
	topicId?: string,
): Promise<string[]> => {
	if (!topicId) {
		return [];
	}

	try {
		const topicInfo = await getKnowledgeDatabase(database).query(
			async ({ db, schema }) => {
				const rows = await db
					.select()
					.from(schema.topics)
					.where(sql`${schema.topics.id} = ${topicId}`)
					.limit(1);

				if (rows.length === 0) {
					return undefined;
				}

				const row = rows[0];
				const name = row.name || "Unknown Topic";
				const description = row.description || row.name || "";
				return description ? `${name}: ${description}` : name;
			},
		);

		return topicInfo ? [topicInfo] : [];
	} catch {
		return [];
	}
};

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
	): MultiAgentManager {
		return new MultiAgentManager({
			childAgents,
			topicId: input.topicId,
			services,
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
			flowConfig = await serviceManager.flowBuilderService.getUnifiedFlowConfig(
				{
					flowId: agentId,
				},
			);
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
		const contextQueries = await loadTopicContextQueries(
			this.config.services.database,
			this.config.topicId,
		);
		const { graph, getInitialState } = chatFlowRegistry.create(
			graphType,
			this.config.services,
			resolvedConfig,
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
