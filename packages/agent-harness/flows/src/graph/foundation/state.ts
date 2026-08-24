import { Annotation } from "@langchain/langgraph";
import { type BaseStateBase, BaseAnnotation } from "../graph.base.js";
import { DEFAULT_AGENT_MAX_ITERATIONS } from "../../limits.js";

export const DEFAULT_FOUNDATION_SYSTEM_PROMPT = `
# Role
You are a assistant.
If Knowledge context avaible use them to answer clearly, accurately, and with structured sections when useful.
If tools or feature-enabled capabilities are available, use them repeatedly when needed to fully solve the user's requirement.
Do not stop after a single attempt if the result is incomplete, ambiguous, or failed. Continue with follow-up tool use, retries, and verification until the task is actually resolved or you have a concrete blocking reason.
If user request visualize use artifact or codeblock html to present UI.
`.trim();

// ---------------------------------------------------------------------------
// Legacy predefined config — kept for backward compatibility
// The UI layer and the service's legacy getFlowConfig/saveFlowConfig paths
// still consume these types.  New code should use UnifiedFlowConfig from
// src/services/flows/interfaces/flow-config.ts instead.
// ---------------------------------------------------------------------------

/** @deprecated Use UnifiedFlowConfig from interfaces/flow-config instead. */
export const DEFAULT_FOUNDATION_PREDEFINED_CONFIG = {
	systemPrompt: "",
	contextPrompt: "",
	tools: ["current_time"] as string[],
	maxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
	enableContextRetrieval: true,
	enableCitations: true,
	retrievalMode: "smart" as "smart" | "quick" | "llm" | "structmem",
	graphType: "foundation" as "foundation" | "agent",
};

/** @deprecated Use UnifiedFlowConfig from interfaces/flow-config instead. */
export type FoundationPredefinedConfig =
	typeof DEFAULT_FOUNDATION_PREDEFINED_CONFIG;

/** @deprecated Canonical config keys used by the service's legacy DB path. */
export const FOUNDATION_CONFIG_KEYS = [
	{ name: "systemPrompt", type: "string" },
	{ name: "contextPrompt", type: "string" },
	{ name: "tools", type: "array" },
	{ name: "maxIterations", type: "number" },
	{ name: "enableContextRetrieval", type: "boolean" },
	{ name: "enableCitations", type: "boolean" },
	{ name: "retrievalMode", type: "string" },
	{ name: "graphType", type: "string" },
] as const;

// ---------------------------------------------------------------------------
// Runtime graph state
// ---------------------------------------------------------------------------

export interface FoundationState extends BaseStateBase {
	graphId?: string;
	/** Additional search context hints (e.g. topic name/description) */
	contextQueries: string[];
	maxIterations: number;
}

export const FoundationAnnotation = {
	...BaseAnnotation,
	graphId: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	contextQueries: Annotation<string[]>({
		value: (x, y) => y ?? x ?? [],
		default: () => [],
	}),
	maxIterations: Annotation<number>({
		value: (x, y) => y ?? x,
		default: () => DEFAULT_AGENT_MAX_ITERATIONS,
	}),
};
