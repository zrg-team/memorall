import { Annotation } from "@langchain/langgraph";
import { BaseAnnotation, type BaseStateBase } from "../graph.base";

export const DEFAULT_AGENT_SYSTEM_PROMPT =
	"You are an intelligent assistant that can use tools to help answer user questions. Use tools when needed to provide accurate answers.";

export interface AgentState extends BaseStateBase {
	/** Maximum iterations to prevent infinite loops */
	maxIterations: number;
	/** Current iteration count */
	currentIteration: number;
}

export const AgentAnnotation = Annotation.Root({
	maxIterations: Annotation<number>({
		value: (x, y) => y ?? x,
		default: () => 10,
	}),
	currentIteration: Annotation<number>({
		value: (x, y) => y ?? x,
		default: () => 0,
	}),
	...BaseAnnotation,
});
