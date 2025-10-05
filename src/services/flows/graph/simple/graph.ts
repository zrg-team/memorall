import { END, START, StateGraph } from "@langchain/langgraph/web";
import { AgentAnnotation, type AgentState } from "./state";

import { GraphBase } from "../../interfaces/graph.base";
import {
	getTool,
	availableTools,
	generateToolInstructions,
	parseToolCall,
	executeToolByName,
} from "../../tools";
import type { AllServices } from "../../interfaces/tool";
import type { ChatCompletionResponse, ChatMessage } from "@/types/openai";
import { logError, logInfo } from "@/utils/logger";

const TOOLS = {
	current_time: availableTools.current_time,
};

const DECISION_SYSTEM_PROMPT = `
You are an intelligent agent that can decide whether to use tools to help answer user questions or not. Below are the available tools you can use:
${Object.values(TOOLS)
	.map((tool) => `- ${tool.name}: ${tool.description}`)
	.join("\n")}
Important: Your answer must be one of the following exactly:
- YES_USE_TOOL: if one of available tools can help answer the user's question.
- NO: if <thought> section contains enough information to answer the user's question.
`;
const ANSWER_SYSTEM_PROMPT = `
You are an intelligent assistant that can provide answers to user questions. Use your knowledge and reasoning skills to generate accurate and helpful responses.
`;
const AGENT_SYSTEM_PROMPT = `
You are an intelligent assistant that can use tools to help answer user questions. Use the tools when appropriate to provide accurate and helpful responses.
You will use the following tools to help you answer user questions:
${generateToolInstructions(TOOLS)}
`;

export class SimpleGraph extends GraphBase<
	"tools" | "agent" | "decision" | "answer",
	AgentState,
	AllServices
> {
	constructor(services: AllServices) {
		super(services);
		this.workflow = new StateGraph(AgentAnnotation);

		// Add nodes
		this.workflow.addNode("agent", this.agentNode);
		this.workflow.addNode("tools", this.toolsNode);
		this.workflow.addNode("decision", this.decisionNode);
		this.workflow.addNode("answer", this.answerNode);

		// Add edge from start to agent
		this.workflow.addEdge(START, "decision");

		this.workflow.addConditionalEdges("decision", this.shouldAnswer);

		// Add conditional edges from agent
		this.workflow.addConditionalEdges("agent", this.shouldCallTool);

		// Add edge from tools back to agent
		this.workflow.addEdge("tools", "decision");

		this.workflow.addEdge("answer", END);

		// Use the base class compile method
		this.compile();
	}

	shouldAnswer(state: AgentState): "agent" | "answer" {
		const next = state.next;
		if (next === "agent") {
			return "agent";
		}
		return "answer";
	}

	shouldCallTool(state: AgentState): "tools" | "decision" {
		const next = state.next;
		const lastStep = state.steps[state.steps.length - 1];

		if (
			next === "tools" &&
			lastStep?.role === "assistant" &&
			lastStep.tool_calls &&
			lastStep.tool_calls.length > 0
		) {
			return "tools";
		}
		return "decision";
	}

	buildChainOfThought(state: AgentState): ChatMessage | undefined {
		let chainOfThought = "";
		if (state.steps?.length) {
			const chains: string[] = [];
			for (const step of state.steps) {
				if (step.role === "assistant" && step.tool_calls?.length) {
					chains.push(`\n---\n${step.content}\n`);
				} else if (step.role === "tool") {
					chains.push(`Result: ${step.content}\n---\n`);
				}
			}
			if (chains?.length) {
				chainOfThought = [
					"\n\n<thought>\n\n",
					"Below is the thought process:",
					...chains,
					"\n\n</thought>\n\n",
				].join("\n");
			}
		}
		return chainOfThought
			? {
					role: "assistant" as const,
					content: chainOfThought.trim(),
				}
			: undefined;
	}

	answerNode = async (state: AgentState): Promise<Partial<AgentState>> => {
		const llm = this.services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		const chainOfThoughtMessage = this.buildChainOfThought(state);
		// Convert to messages for LLM
		const messages: ChatMessage[] = [
			{ role: "system" as const, content: ANSWER_SYSTEM_PROMPT },
			...(chainOfThoughtMessage ? [chainOfThoughtMessage] : []),
			...state.messages,
		];

		logInfo("[ANSWER] LLM messages:", messages);

		// Use actual LLM service instead of pattern matching
		const llmResponse = await llm.chatCompletions({
			messages: messages,
			max_tokens: 4096,
			temperature: 0.1,
			stream: true,
		});

		let responseContent = "";
		if (Symbol.asyncIterator in llmResponse) {
			for await (const chunk of llmResponse) {
				responseContent += chunk.choices[0].delta.content || "";
				if (this.callbacks?.onNewChunk) {
					this.callbacks.onNewChunk(chunk);
				}
			}
		}
		logInfo("[ANSWER] LLM response:", responseContent);

		return {
			finalMessage: responseContent,
		};
	};

	decisionNode = async (state: AgentState): Promise<Partial<AgentState>> => {
		const llm = this.services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		const chainOfThoughtMessage = this.buildChainOfThought(state);
		// Convert to messages for LLM
		const messages: ChatMessage[] = [
			{ role: "system" as const, content: DECISION_SYSTEM_PROMPT },
			...(chainOfThoughtMessage ? [chainOfThoughtMessage] : []),
			...state.messages,
		];

		logInfo("[DECISION] LLM messages:", messages);

		// Use actual LLM service instead of pattern matching
		const llmResponse = (await llm.chatCompletions({
			messages: messages,
			max_tokens: 4096,
			temperature: 0,
			stream: false,
		})) as ChatCompletionResponse;

		const responseContent = llmResponse.choices[0].message.content || "";
		logInfo("[DECISION] LLM response:", responseContent);

		if (responseContent.includes("YES_USE_TOOL")) {
			return {
				next: "agent",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Use tool",
						description: responseContent
							.replace("YES_USE_TOOL:", "")
							.replace("YES_USE_TOOL", "")
							.trim(),
						metadata: {},
					},
				],
			};
		} else {
			return {
				next: "answer",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "No tool needed",
						description: responseContent
							.replace("NO:", "")
							.replace("NO", "")
							.trim(),
						metadata: {},
					},
				],
			};
		}
	};

	agentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
		const llm = this.services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		try {
			const chainOfThoughtMessage = this.buildChainOfThought(state);
			// Convert to messages for LLM
			const messages: ChatMessage[] = [
				{ role: "system" as const, content: AGENT_SYSTEM_PROMPT },
				...(chainOfThoughtMessage ? [chainOfThoughtMessage] : []),
				...state.messages,
			];

			logInfo("[AGENT] LLM messages:", messages);

			// Use actual LLM service instead of pattern matching
			const llmResponse = (await llm.chatCompletions({
				messages: messages,
				max_tokens: 4096,
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;
			const responseContent = llmResponse.choices[0].message.content || "";
			logInfo("[AGENT] response:", responseContent);

			// Parse tool calls from LLM response
			const toolCall = parseToolCall(responseContent);
			let newStep;

			if (toolCall) {
				// Create assistant step with tool call
				const toolCalls = [
					{
						id: crypto.randomUUID(),
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					},
				];

				newStep = {
					role: "assistant" as const,
					content: responseContent,
					tool_calls: toolCalls,
				};

				return {
					steps: [newStep],
					next: "tools",
					actions: [
						{
							id: crypto.randomUUID(),
							name: `Call "${toolCall.name}"`,
							description: `Calling tool ${toolCall.name} with arguments ${JSON.stringify(toolCall.arguments)}`,
							metadata: {},
						},
					],
				};
			} else {
				// Create final assistant response step
				newStep = {
					role: "assistant" as const,
					content: responseContent,
				};

				return {
					steps: [newStep],
					next: "decision",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Thinking next step",
							description: "",
							metadata: {},
						},
					],
				};
			}
		} catch (error) {
			logError("Agent node error:", error);
			throw error;
		}
	};

	async toolsNode(state: AgentState): Promise<Partial<AgentState>> {
		const lastStep = state.steps[state.steps.length - 1];

		if (!lastStep?.tool_calls || lastStep.tool_calls.length === 0) {
			throw new Error("No tool calls found in the last step");
		}

		const toolResultSteps = [];

		// Execute each tool call
		for (const toolCall of lastStep.tool_calls) {
			const tool = getTool(toolCall.name);

			if (!tool) {
				toolResultSteps.push({
					role: "tool" as const,
					content: `Error: Tool '${toolCall.name}' not found`,
					tool_call_id: toolCall.id,
				});
				continue;
			}

			try {
				// Parse tool arguments
				const args = JSON.parse(toolCall.arguments);

				// Execute the tool with validation and type safety
				const result = await executeToolByName(
					toolCall.name,
					args,
					this.services,
				);

				// Add tool result to steps
				toolResultSteps.push({
					role: "tool" as const,
					content: result,
					tool_call_id: toolCall.id,
				});
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				toolResultSteps.push({
					role: "tool" as const,
					content: `Error executing ${toolCall.name}: ${errorMessage}`,
					tool_call_id: toolCall.id,
				});
			}
		}

		return {
			steps: toolResultSteps,
			next: "decision",
			actions: [
				{
					id: crypto.randomUUID(),
					name: `Executed ${toolResultSteps.length} tool(s)`,
					description: "",
					metadata: {},
				},
			],
		};
	}
}

// Self-register the flow
import { flowRegistry } from "../../flow-registry";

flowRegistry.register({
	flowType: "simple",
	factory: (services) => new SimpleGraph(services),
});

// Extend global FlowTypeRegistry for type-safe flow creation
declare global {
	interface FlowTypeRegistry {
		simple: {
			services: AllServices;
			flow: SimpleGraph;
		};
	}
}
