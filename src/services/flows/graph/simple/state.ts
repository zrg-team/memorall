import { Annotation } from "@langchain/langgraph/web";
import {
	BaseAnnotation,
	type BaseStateBase,
} from "../../interfaces/graph.base";
import type { ChatMessage } from "@/types/openai";

export interface AgentState extends BaseStateBase {
	messages: ChatMessage[];
	next?: string;
	steps: Array<{
		role: "user" | "assistant" | "tool";
		content: string;
		tool_calls?: Array<{
			id: string;
			name: string;
			arguments: string;
		}>;
		tool_call_id?: string;
	}>;
}

export const AgentAnnotation = Annotation.Root({
	messages: Annotation<AgentState["messages"]>({
		value: (x, y) => x.concat(y),
		default: () => [],
	}),
	steps: Annotation<AgentState["steps"]>({
		value: (x, y) => x.concat(y),
		default: () => [],
	}),
	next: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	...BaseAnnotation,
});
