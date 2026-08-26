import { END, START, StateGraph } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	AgentAnnotation,
	DEFAULT_AGENT_SYSTEM_PROMPT,
	type AgentState,
	type ToolFailureStreak,
} from "./state.js";
import {
	buildResponseFromOutputMessages,
	createOutputMessageChunks,
	GraphBase,
	normalizeChatMessages,
	type CombinedTool,
	type GraphTool,
} from "../graph.base.js";
import type { CombinedServices } from "../../interfaces/engine/tool.js";
import {
	extractToolResult,
	parseToolInput,
} from "../../interfaces/engine/tool.js";
import { getFlowRuntimeVars } from "../../context/runtime-context.js";
import { getFlowRunLifecycle } from "../../context/run-lifecycle.js";
import { streamAssistantTurn } from "./assistant-turn.js";
import {
	correctionsExhausted,
	findToolArgumentProblem,
	nextCorrectionCount,
} from "./tool-arguments.js";
import { logError, logInfo } from "../../logging/logger.js";
import {
	graphRegistry,
	FEATURE_SLOT,
} from "../../registries/graph-registry.js";
import type { BaseGraph } from "../../registries/graph-registry.js";
import { findEnabledStepByName } from "../../interfaces/config/flow-config.js";
import type { FlowRegistrySet } from "../../registries/registry-set.js";
import { normalizeAgentMaxIterations } from "../../limits.js";

// Tool names available to the agent
const DEFAULT_TOOL_NAMES = ["current_time"] as const;

// Derive services from tools + graph's own needs (llm for calling the model)
type AgentServices = CombinedServices<typeof DEFAULT_TOOL_NAMES, "llm">;

type AgentGraphConfig = {
	systemPrompt?: string;
	tools?: GraphTool[];
	maxIterations?: number;
};

export const MAX_CONSECUTIVE_TOOL_FAILURES = 3;

const summarizeToolFailure = (message: string): string => {
	const missingFields = message.match(
		/Invalid request data provided[\s\S]*?Following fields are missing:\s*(\{[^}]+\})/i,
	);
	if (missingFields?.[1]) {
		return `Invalid request data provided; missing ${missingFields[1]}.`;
	}

	const normalized = message.replace(/\s+/g, " ").trim();
	return normalized.length > 300
		? `${normalized.slice(0, 297)}...`
		: normalized;
};

const nextToolFailureStreak = (
	current: ToolFailureStreak | null | undefined,
	toolName: string,
	message: string,
): ToolFailureStreak => ({
	toolName,
	count: current?.toolName === toolName ? current.count + 1 : 1,
	message: summarizeToolFailure(message),
});

// Streamed tool-call assembly moved next to the turn that performs it; both stay
// exported here because callers and tests already reach for them at this path.
export {
	mergeStreamedToolCall,
	type AssembledToolCall,
} from "./assistant-turn.js";

/**
 * Simple Agent Graph with 2 nodes:
 * - initial: update system prompt
 * - agent: Calls LLM to decide whether to use tools or respond
 * - tools: Executes tool calls and returns results
 *
 * Flow:
 * START -> initial -> agent -> (tool_calls?) -> tools -> agent (loop)
 *                -> (no tool_calls) -> END
 */
export class AgentGraph extends GraphBase<
	"initial" | "agent" | "tool_executor",
	AgentState,
	AgentServices
> {
	private combinedTools: CombinedTool[];
	private executorMap: Map<string, CombinedTool>;
	private systemPrompt = DEFAULT_AGENT_SYSTEM_PROMPT;
	private maxIterations?: number;

	constructor(
		services: AgentServices,
		config: AgentGraphConfig = {},
		registries?: FlowRegistrySet,
	) {
		super(services, registries);

		if (config.systemPrompt) {
			this.systemPrompt = config.systemPrompt;
		}
		this.maxIterations =
			config.maxIterations === undefined
				? undefined
				: normalizeAgentMaxIterations(config.maxIterations);

		// Create bound tools with services
		this.combinedTools = this.chat.combineTools(
			config.tools || [...DEFAULT_TOOL_NAMES],
			services,
		);
		this.executorMap = new Map(
			this.combinedTools.map((t) => [t.executor.name, t]),
		);

		this.workflow = new StateGraph(AgentAnnotation);

		// Add nodes
		this.addNode("initial", this.initialNode);
		this.addNode("agent", this.agentNode);
		this.addNode("tool_executor", this.toolsNode);

		this.workflow.addEdge(START, "initial");
		this.workflow.addEdge("initial", "agent");
		this.workflow.addConditionalEdges("agent", this.routeAfterAgent);
		this.workflow.addEdge("tool_executor", "agent");

		this.compile();
	}

	/**
	 * Route after agent node:
	 * - agentNode writes tool-call messages to outputMessages (working memory)
	 * - agentNode finished path commits to messages and does NOT write to outputMessages
	 * So: pending tool calls are always the last item in outputMessages.
	 */
	private routeAfterAgent = (
		state: AgentState,
	): "tool_executor" | typeof END => {
		if (state.currentIteration >= state.maxIterations) {
			logInfo(
				`[AGENT] Max iterations (${state.maxIterations}) reached, ending`,
			);
			return END;
		}

		const lastOutputMessage = this.chat.lastMessage(state.outputMessages);
		if (
			lastOutputMessage?.role === "assistant" &&
			lastOutputMessage.tool_calls?.length
		) {
			return "tool_executor";
		}

		return END;
	};

	initialNode = (state: AgentState): Partial<AgentState> => {
		return {
			messages: this.chat.systemMessage(state.messages, this.systemPrompt),
			...(this.maxIterations === undefined
				? {}
				: { maxIterations: this.maxIterations }),
		};
	};

	/**
	 * Agent node: streams LLM response and decides on tool use or final response.
	 *
	 * LLM context = stable messages + accumulated working memory (outputMessages).
	 *
	 * Tool call path  → writes assistant message (with tool_calls) to outputMessages.
	 * Finished path   → commits all working memory + final response into messages.
	 */
	agentNode = async (
		state: AgentState,
		runConfig?: LangGraphRunnableConfig,
	): Promise<Partial<AgentState>> => {
		const llm = this.services.llm;
		if (!llm.isReady()) throw new Error("LLM service is not ready");

		if (
			state.toolFailureStreak &&
			state.toolFailureStreak.count >= MAX_CONSECUTIVE_TOOL_FAILURES
		) {
			const { toolName, count, message } = state.toolFailureStreak;
			const content =
				`I stopped retrying ${toolName} after ${count} consecutive errors. ` +
				`${message} Check the tool inputs or connection, then try again.`;
			const finalMessage = { role: "assistant" as const, content };
			const committedMessages = [...state.outputMessages, finalMessage];
			for (const chunk of createOutputMessageChunks([finalMessage])) {
				runConfig?.writer?.({ type: "llm", chunk });
			}
			logInfo(
				`[AGENT] Stopped repeated ${toolName} failure after ${count} attempts`,
			);

			return {
				outputMessages: [finalMessage],
				messages: [...state.messages, ...committedMessages],
				response: buildResponseFromOutputMessages([], committedMessages),
				toolFailureStreak: null,
			};
		}

		// Full LLM context: stable history + working memory accumulated so far
		const tools = this.combinedTools.map((t) => t.tool);

		logInfo(
			"[AGENT] Calling LLM with",
			state.messages.length + state.outputMessages.length,
			"messages and",
			tools.length,
			"tools",
		);

		const turn = await streamAssistantTurn(
			{ messages: state.messages, outputMessages: state.outputMessages },
			{
				llm,
				tools,
				lifecycle: getFlowRunLifecycle(runConfig),
				onChunk: (chunk) => runConfig?.writer?.({ type: "llm", chunk }),
			},
		);

		const { content, toolCalls } = turn;
		/*
		 * A refusal the turn recovered from is recovered for good: the compacted
		 * conversation is what the next iteration must build on, or the very next
		 * request re-sends the context the provider just rejected.
		 */
		const { messages, outputMessages } = turn.conversation;

		logInfo(
			"[AGENT] Stream complete - content:",
			content.length,
			"tool_calls:",
			toolCalls.length,
			turn.compacted ? "(context compacted to fit the provider budget)" : "",
		);

		// Tool call path: write assistant message to working memory, defer final commit
		if (toolCalls.length > 0) {
			return {
				outputMessages: [
					...outputMessages,
					{
						role: "assistant" as const,
						content: content || null,
						tool_calls: toolCalls,
					},
				],
				...(turn.compacted ? { messages } : {}),
				currentIteration: state.currentIteration + 1,
			};
		}

		// Finished path: commit working memory + final response into messages
		const finalMessage = { role: "assistant" as const, content };
		const committedMessages = [...outputMessages, finalMessage];

		return {
			outputMessages: [finalMessage],
			messages: [...messages, ...committedMessages],
			response: buildResponseFromOutputMessages([], committedMessages),
			currentIteration: state.currentIteration + 1,
		};
	};

	/**
	 * Tools node: executes tool calls from working memory, appends results to working memory.
	 * Only updates outputMessages — messages stays intact until agentNode finishes.
	 */
	toolsNode = async (
		state: AgentState,
		runConfig?: LangGraphRunnableConfig,
	): Promise<Partial<AgentState>> => {
		// The pending tool-call message is always the last item in working memory
		const lastMessage = this.chat.lastMessage(state.outputMessages);

		if (lastMessage?.role !== "assistant" || !lastMessage.tool_calls?.length) {
			throw new Error("No tool calls found in working memory");
		}

		// Fresh working copy so tool executors can push messages via appendOutputMessagesToState
		const toolState: AgentState = { ...state, outputMessages: [] };
		let toolStateOffset = 0;
		const outputMessages: AgentState["outputMessages"] = [];
		let toolFailureStreak = state.toolFailureStreak ?? null;
		let argumentCorrections = state.argumentCorrections ?? {};

		logInfo("[TOOL EXECUTE] Start tool calls", lastMessage.tool_calls);

		for (const toolCall of lastMessage.tool_calls) {
			const toolName = toolCall.function.name;
			const combined = this.executorMap.get(toolName);
			// Identity the result alone cannot carry: which MCP server a tool came
			// from, its original (unprefixed) name, its output schema. The UI reads
			// this to label the card as something other than a raw JSON dump.
			const toolMetadata = combined?.executor.metadata;
			const startedAtMs = Date.now();
			let parsedInput: unknown = toolCall.function.arguments;
			try {
				parsedInput = JSON.parse(toolCall.function.arguments);
			} catch {
				// The executor will surface invalid JSON as a tool error below.
			}
			runConfig?.writer?.({
				type: "execute-start",
				node: "tool_executor",
				metadata: {
					tool: toolName,
					tool_call_id: toolCall.id,
					input: parsedInput,
					startedAt: new Date(startedAtMs).toISOString(),
					...(toolMetadata ? { tool_metadata: toolMetadata } : {}),
				},
			});

			if (!combined) {
				const content = `Error: Tool '${toolName}' not found`;
				toolFailureStreak = nextToolFailureStreak(
					toolFailureStreak,
					toolName,
					content,
				);
				const endedAtMs = Date.now();
				runConfig?.writer?.({
					type: "tool-result",
					node: "tool_executor",
					metadata: {
						tool: toolName,
						tool_call_id: toolCall.id,
						content,
						isError: true,
						endedAt: new Date(endedAtMs).toISOString(),
						durationMs: endedAtMs - startedAtMs,
						...(toolMetadata ? { tool_metadata: toolMetadata } : {}),
					},
				});
				const toolMessage = {
					role: "tool" as const,
					content,
					tool_call_id: toolCall.id,
				};
				outputMessages.push(toolMessage);
				for (const chunk of createOutputMessageChunks([toolMessage])) {
					runConfig?.writer?.({ type: "llm", chunk });
				}
				continue;
			}

			/*
			 * A call with nothing where the parameters go is already lost: the
			 * server answers "following fields are missing", which reads as a
			 * broken tool and, repeated, ends the run. We hold the schema the model
			 * was missing, so the useful reply is that schema — handed back as this
			 * tool's result, in time for the next iteration to get it right.
			 */
			const argumentProblem = correctionsExhausted(argumentCorrections, toolName)
				? undefined
				: findToolArgumentProblem(combined.executor, parsedInput);

			if (argumentProblem) {
				argumentCorrections = nextCorrectionCount(argumentCorrections, toolName);
				const content = argumentProblem.correction;
				logInfo(
					`[TOOL EXECUTE] Returning ${argumentProblem.target} its schema instead of dispatching an empty call`,
				);
				const endedAtMs = Date.now();
				runConfig?.writer?.({
					type: "tool-result",
					node: "tool_executor",
					metadata: {
						tool: toolName,
						tool_call_id: toolCall.id,
						content,
						isError: true,
						endedAt: new Date(endedAtMs).toISOString(),
						durationMs: endedAtMs - startedAtMs,
						...(toolMetadata ? { tool_metadata: toolMetadata } : {}),
					},
				});
				const toolMessage = {
					role: "tool" as const,
					content,
					tool_call_id: toolCall.id,
				};
				outputMessages.push(toolMessage);
				for (const chunk of createOutputMessageChunks([toolMessage])) {
					runConfig?.writer?.({ type: "llm", chunk });
				}
				// Deliberately not a failure: the tool never ran, and counting a
				// correction toward the give-up streak would spend the model's
				// retries on the very loop this exists to break.
				continue;
			}

			try {
				const args = JSON.parse(toolCall.function.arguments);
				const validatedArgs = parseToolInput(combined.executor.schema, args);
				const rawResult = await combined.executor.execute(validatedArgs, {
					state: toolState,
					runtime: getFlowRuntimeVars(runConfig),
				});
				const { content, contentText, structuredContent, isError, meta } =
					extractToolResult(rawResult);
				toolFailureStreak = isError
					? nextToolFailureStreak(toolFailureStreak, toolName, contentText)
					: null;
				const endedAtMs = Date.now();
				runConfig?.writer?.({
					type: "tool-result",
					node: "tool_executor",
					metadata: {
						tool: toolName,
						tool_call_id: toolCall.id,
						structuredContent,
						content: contentText,
						isError,
						meta,
						endedAt: new Date(endedAtMs).toISOString(),
						durationMs: endedAtMs - startedAtMs,
						...(toolMetadata ? { tool_metadata: toolMetadata } : {}),
					},
				});

				// Collect any messages the tool executor pushed to its local working copy
				const executorMessages =
					toolState.outputMessages.slice(toolStateOffset);
				toolStateOffset = toolState.outputMessages.length;
				outputMessages.push(...executorMessages);
				for (const chunk of createOutputMessageChunks(executorMessages)) {
					runConfig?.writer?.({ type: "llm", chunk });
				}

				const toolMessage = {
					role: "tool" as const,
					content,
					tool_call_id: toolCall.id,
				};
				outputMessages.push(toolMessage);
				for (const chunk of createOutputMessageChunks([toolMessage])) {
					runConfig?.writer?.({ type: "llm", chunk });
				}
				logInfo(
					"[TOOL EXECUTE] Tool result",
					toolCall.function.name,
					contentText,
				);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				logError(`[TOOLS] Error executing ${toolName}:`, error);

				const content = `Error: ${errorMessage}`;
				toolFailureStreak = nextToolFailureStreak(
					toolFailureStreak,
					toolName,
					errorMessage,
				);
				const endedAtMs = Date.now();
				runConfig?.writer?.({
					type: "tool-result",
					node: "tool_executor",
					metadata: {
						tool: toolName,
						tool_call_id: toolCall.id,
						content,
						isError: true,
						endedAt: new Date(endedAtMs).toISOString(),
						durationMs: endedAtMs - startedAtMs,
						...(toolMetadata ? { tool_metadata: toolMetadata } : {}),
					},
				});
				const toolMessage = {
					role: "tool" as const,
					content,
					tool_call_id: toolCall.id,
				};
				outputMessages.push(toolMessage);
				for (const chunk of createOutputMessageChunks([toolMessage])) {
					runConfig?.writer?.({ type: "llm", chunk });
				}
			}
		}

		// Only update working memory — messages stays intact until agentNode finishes
		return {
			outputMessages: [...state.outputMessages, ...outputMessages],
			toolFailureStreak,
			argumentCorrections,
		};
	};
}

graphRegistry.register(
	"agent",
	(services, config, context) =>
		new AgentGraph(services, config as AgentGraphConfig, context?.registries),
	{
		stepDefaults: {
			"add-system": { content: DEFAULT_AGENT_SYSTEM_PROMPT },
		},
		stepOrder: ["add-system", FEATURE_SLOT, "agent-completion"],
		chat: (services, config, context) => {
			const addSystemStep = findEnabledStepByName(config, "add-system");
			const agentCompletionStep = findEnabledStepByName(
				config,
				"agent-completion",
			);

			const systemPrompt =
				(addSystemStep?.config?.content as string | undefined) || undefined;
			const tools =
				(agentCompletionStep?.config?.tools as GraphTool[] | undefined) ?? [];
			const maxIterations = normalizeAgentMaxIterations(
				agentCompletionStep?.config?.maxIterations,
			);

			const graph = new AgentGraph(
				services,
				{
					systemPrompt,
					tools: tools.length > 0 ? tools : undefined,
					maxIterations,
				},
				context?.registries,
			);

			return {
				graph: graph as BaseGraph,
				getInitialState: (ctx) => ({
					messages: normalizeChatMessages(ctx.messages),
					maxIterations,
				}),
			};
		},
	},
	{ description: "Tool-using agent chat graph." },
);

// Extend global GraphTypeRegistry for type-safe graph creation
declare global {
	interface GraphTypeRegistry {
		agent: {
			services: AgentServices;
			config: AgentGraphConfig;
			graph: AgentGraph;
		};
	}
}
