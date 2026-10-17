import { graphRegistry } from "../../../registries/graph-registry.js";
import type { UnifiedFlowConfig } from "../../../interfaces/config/flow-config.js";
import type { AllServices } from "../../../interfaces/services/services.js";
import { normalizeLangGraphStreamChunk } from "../../../utils/langgraph-stream.js";
import type { ChatCompletionMessageParam } from "../../../interfaces/engine/messages.js";
import type {
	ChildAgentExchange,
	ChildAgentMessageOptions,
	ChildAgentMessageResult,
} from "../../../interfaces/tools/multi-agent.js";
import { logInfo, logWarn } from "../../../logging/logger.js";
import { ChildRunRecorder } from "./child-run-recorder.js";
import type { FlowRegistrySet } from "../../../registries/registry-set.js";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

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
	runConfig?: LangGraphRunnableConfig;
}

/** A child's side of its conversation with the parent, for this run. */
interface ChildConversation {
	/**
	 * What the child read last, as it read it: every message, reminder, tool
	 * call and result, without the system prompt its flow rebuilds each time.
	 */
	messages: ChatCompletionMessageParam[];
	/** Messages the parent has sent it. */
	turns: number;
	/** The latest of those messages, for the chat to show what the child recalls. */
	exchanges: ChildAgentExchange[];
}

/** How many earlier messages a run lists; the count says how many there are. */
const MAX_LISTED_EXCHANGES = 10;

interface ChildFlowResult {
	response: string;
	transcript?: ChatCompletionMessageParam[];
}

/**
 * The child's flow writes its system prompt fresh on every message. Replayed
 * as well, it would be merged in a second time and change the opening bytes
 * of every request.
 */
const withoutSystemMessages = (
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] =>
	messages.filter((message) => message.role !== "system");

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
	private readonly conversations = new Map<string, ChildConversation>();

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
		runConfig?: LangGraphRunnableConfig,
	): MultiAgentManager {
		return new MultiAgentManager({
			childAgents,
			topicId: input.topicId,
			services,
			registries,
			runConfig,
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

	/**
	 * Send the child one message, as the next turn of its conversation.
	 *
	 * The child reads its whole conversation so far exactly as it read it the
	 * last time — its earlier tool calls and their results included, not just
	 * the answers it gave. That is what lets it build on its own work, and it is
	 * what keeps its requests append-only: each one starts with the bytes of
	 * the last, so the provider serves that prefix from its prompt cache.
	 */
	async sendMessage(
		agentId: string,
		message: string,
		options?: ChildAgentMessageOptions,
	): Promise<ChildAgentMessageResult> {
		const childAgent = this.getChildAgent(agentId);
		if (!childAgent) {
			throw new Error(
				`Agent '${agentId}' is not in the selected child-agent list.`,
			);
		}

		const conversation = this.conversations.get(agentId) ?? {
			messages: [],
			turns: 0,
			exchanges: [],
		};
		const turn = conversation.turns + 1;
		const messages: ChatCompletionMessageParam[] = [
			...conversation.messages,
			{ role: "user", content: message },
		];
		const recorder = new ChildRunRecorder(
			{
				agent: { id: childAgent.id, name: childAgent.name },
				turn,
				history: conversation.exchanges,
			},
			options,
		);
		recorder.start();

		let result: Awaited<ReturnType<typeof this.executeChildFlow>>;
		try {
			result = await this.executeChildFlow(agentId, messages, recorder);
		} catch (error) {
			// Ended, and said so: the card otherwise kept its last step running.
			recorder.finish({
				error,
				aborted:
					this.config.runConfig?.signal?.aborted === true ||
					(error instanceof Error && error.name === "AbortError"),
			});
			throw error;
		}
		const reply = result.response.trim();
		const run = recorder.finish({ replied: Boolean(reply) });
		// Said plainly, so the parent does not take silence for "still working".
		const response =
			reply ||
			(run.endReason === "step_limit"
				? `${childAgent.name} used all its steps before it could reply, so nothing came back. Send it a smaller, more specific task, or carry on without it.`
				: `${childAgent.name} finished without a reply.`);
		this.conversations.set(agentId, {
			// A flow that reports no transcript gets the conversation it was
			// sent plus its answer: still a conversation, only without the work.
			messages: result.transcript
				? withoutSystemMessages(result.transcript)
				: [...messages, { role: "assistant", content: response }],
			turns: turn,
			exchanges: [
				...conversation.exchanges,
				recorder.toExchange(message, response),
			].slice(-MAX_LISTED_EXCHANGES),
		});

		return { response, run };
	}

	dispose(): void {
		this.conversations.clear();
	}

	private async executeChildFlow(
		agentId: string,
		messages: ChatCompletionMessageParam[],
		recorder: ChildRunRecorder,
	): Promise<ChildFlowResult> {
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

		const childRunConfig = this.config.services.flowCatalog?.getRunConfig?.(
			{ flowId: agentId },
			this.config.runConfig,
		) ?? { configurable: this.config.runConfig?.configurable };
		const stream = await graph.stream(
			getInitialState({
				messages,
				topicId: this.config.topicId,
				contextQueries,
			}),
			{
				...childRunConfig,
				signal: this.config.runConfig?.signal ?? childRunConfig.signal,
				streamMode: ["custom", "values"],
			},
		);

		const result: ChildFlowResult = { response: "" };

		for await (const partial of stream) {
			const { mode, payload } = normalizeLangGraphStreamChunk(partial);
			if (mode === "custom") {
				recorder.record(payload);
				continue;
			}
			if (mode !== "values") {
				continue;
			}

			const stateValues = payload as Record<string, unknown>;
			if (typeof stateValues.response === "string") {
				result.response = stateValues.response;
			}
			if (Array.isArray(stateValues.transcript)) {
				result.transcript =
					stateValues.transcript as ChatCompletionMessageParam[];
			}
		}

		return result;
	}
}

interface ChatCompletionMessageParamContainer {
	topicId?: string;
}
