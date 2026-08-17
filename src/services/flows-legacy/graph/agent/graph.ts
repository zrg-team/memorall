import { END, START, StateGraph } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	AgentAnnotation,
	DEFAULT_AGENT_SYSTEM_PROMPT,
	type AgentState,
} from "@/services/flows-legacy/graph/agent/state";
import {
	buildResponseFromOutputMessages,
	createOutputMessageChunks,
	GraphBase,
	normalizeChatMessages,
	type CombinedTool,
	type GraphTool,
} from "@/services/flows-legacy/graph/graph.base";
import type { CombinedServices } from "@/services/flows-legacy/interfaces/engine/tool";
import {
	extractToolResult,
	parseToolInput,
} from "@/services/flows-legacy/interfaces/engine/tool";
import { getFlowRuntimeVars } from "@/services/flows-legacy/runtime/runtime-context";
import type { ChatCompletionChunk } from "@/services/flows-legacy/interfaces/engine/messages";
import { logError, logInfo } from "@/services/flows-legacy/utils/logger";
import {
	graphRegistry,
	FEATURE_SLOT,
} from "@/services/flows-legacy/registries/graph-registry";
import type { BaseGraph } from "@/services/flows-legacy/registries/graph-registry";
import { findEnabledStepByName } from "@/services/flows-legacy/interfaces/config/flow-config";
import type { FlowRegistrySet } from "@/services/flows-legacy/registries/registry-set";

// Tool names available to the agent
const DEFAULT_TOOL_NAMES = ["current_time"] as const;

// Derive services from tools + graph's own needs (llm for calling the model)
type AgentServices = CombinedServices<typeof DEFAULT_TOOL_NAMES, "llm">;

type AgentGraphConfig = {
	systemPrompt?: string;
	tools?: GraphTool[];
};

export type AssembledToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export function mergeStreamedToolCall(
	toolCallsMap: Map<number, AssembledToolCall>,
	tc: NonNullable<
		ChatCompletionChunk["choices"][number]["delta"]["tool_calls"]
	>[number],
): void {
	const existing = toolCallsMap.get(tc.index);
	if (existing) {
		if (tc.id) {
			existing.id = tc.id;
		}
		if (tc.function?.name) {
			existing.function.name += tc.function.name;
		}
		if (tc.function?.arguments) {
			existing.function.arguments += tc.function.arguments;
		}
		return;
	}

	toolCallsMap.set(tc.index, {
		id: tc.id || crypto.randomUUID(),
		type: "function",
		function: {
			name: tc.function?.name || "",
			arguments: tc.function?.arguments || "",
		},
	});
}

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

	constructor(
		services: AgentServices,
		config: AgentGraphConfig = {},
		registries?: FlowRegistrySet,
	) {
		super(services, registries);

		if (config.systemPrompt) {
			this.systemPrompt = config.systemPrompt;
		}

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

		// Full LLM context: stable history + working memory accumulated so far
		const llmMessages = [...state.messages, ...state.outputMessages];
		const tools = this.combinedTools.map((t) => t.tool);

		logInfo(
			"[AGENT] Calling LLM with",
			llmMessages.length,
			"messages and",
			tools.length,
			"tools",
		);

		const stream = llm.chatCompletions({
			messages: llmMessages,
			tools,
			tool_choice: "auto",
			stream: true,
		}) as AsyncIterableIterator<ChatCompletionChunk>;

		let content = "";
		const toolCallsMap = new Map<number, AssembledToolCall>();

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta;
			if (delta?.content) content += delta.content;
			runConfig?.writer?.({ type: "llm", chunk });

			if (delta?.tool_calls) {
				for (const tc of delta.tool_calls) {
					mergeStreamedToolCall(toolCallsMap, tc);
				}
			}
		}

		const toolCalls = Array.from(toolCallsMap.values());
		logInfo(
			"[AGENT] Stream complete - content:",
			content.length,
			"tool_calls:",
			toolCalls.length,
		);

		// Tool call path: write assistant message to working memory, defer final commit
		if (toolCalls.length > 0) {
			return {
				outputMessages: [
					...state.outputMessages,
					{
						role: "assistant" as const,
						content: content || null,
						tool_calls: toolCalls,
					},
				],
				currentIteration: state.currentIteration + 1,
			};
		}

		// Finished path: commit working memory + final response into messages
		const finalMessage = { role: "assistant" as const, content };
		const committedMessages = [...state.outputMessages, finalMessage];

		return {
			outputMessages: [finalMessage],
			messages: [...state.messages, ...committedMessages],
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

			try {
				const args = JSON.parse(toolCall.function.arguments);
				const validatedArgs = parseToolInput(combined.executor.schema, args);
				const rawResult = await combined.executor.execute(validatedArgs, {
					state: toolState,
					runtime: getFlowRuntimeVars(runConfig),
				});
				const { content, contentText, structuredContent, isError, meta } =
					extractToolResult(rawResult);
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
		return { outputMessages: [...state.outputMessages, ...outputMessages] };
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

			const graph = new AgentGraph(
				services,
				{
					systemPrompt,
					tools: tools.length > 0 ? tools : undefined,
				},
				context?.registries,
			);

			return {
				graph: graph as BaseGraph,
				getInitialState: (ctx) => ({
					messages: normalizeChatMessages(ctx.messages),
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
