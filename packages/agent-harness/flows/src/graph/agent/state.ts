import { Annotation } from "@langchain/langgraph";
import { BaseAnnotation, type BaseStateBase } from "../graph.base.js";
import { DEFAULT_AGENT_MAX_ITERATIONS } from "../../limits.js";

export const DEFAULT_AGENT_SYSTEM_PROMPT =
	"You are an intelligent assistant that can use tools to help answer user questions. Use tools when needed to provide accurate answers.";

export interface ToolFailureStreak {
	toolName: string;
	count: number;
	message: string;
}

export interface AgentState extends BaseStateBase {
	/** Maximum iterations to prevent infinite loops */
	maxIterations: number;
	/** Current iteration count */
	currentIteration: number;
	/** Consecutive failures from the same tool, used to stop retry loops. */
	toolFailureStreak?: ToolFailureStreak | null;
	/**
	 * How many times each tool has been handed its schema back after being
	 * called with nothing in it. Bounded so a model that cannot use the schema
	 * still reaches the real call rather than looping on our correction.
	 */
	argumentCorrections?: Record<string, number>;
}

export const AgentAnnotation = Annotation.Root({
	maxIterations: Annotation<number>({
		value: (x, y) => y ?? x,
		default: () => DEFAULT_AGENT_MAX_ITERATIONS,
	}),
	currentIteration: Annotation<number>({
		value: (x, y) => y ?? x,
		default: () => 0,
	}),
	toolFailureStreak: Annotation<ToolFailureStreak | null>({
		value: (x, y) => (y === undefined ? x : y),
		default: () => null,
	}),
	argumentCorrections: Annotation<Record<string, number>>({
		value: (x, y) => y ?? x,
		default: () => ({}),
	}),
	...BaseAnnotation,
});
