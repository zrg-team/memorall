/**
 * Graph contracts.
 *
 * These describe what a graph is made of — the tools it may hold and the state
 * it carries — without describing how one runs. They live here so the registry
 * and the runtime can talk about a graph without importing the `graph/` layer
 * that implements one, which is what used to make those layers circular.
 */

import type { ChatCompletionMessageParam, ChatCompletionTool } from "./messages.js";
import type { BaseTool, ToolBinding } from "./tool.js";

export type ToolName = `${keyof ToolTypeRegistry & string}`;

export interface CombinedTool {
	executor: BaseTool;
	tool: ChatCompletionTool;
}

export interface ConfiguredGraphTool<TConfig = unknown>
	extends ToolBinding<ToolName, TConfig> {}

export type GraphTool = ToolName | ConfiguredGraphTool | BaseTool;

/**
 * Names a tool the *host* registers, not this runtime.
 *
 * `ToolName` is the union of tools registered here, so a feature that hands the
 * model a host-provided capability — an artifact renderer, an image fetcher —
 * cannot name it and still typecheck. Reaching for the host's own declaration
 * inverts the dependency: the runtime would need its consumer to exist before
 * it compiles, which is exactly what stops this code from being a package.
 *
 * So the requirement is stated here instead, in one greppable place. A feature
 * declaring `hostTool("render_artifact")` is saying "the host must register
 * this"; if it does not, the tool is simply absent at run time, which is the
 * same outcome as any unregistered name. Grep for `hostTool(` to see every
 * capability this runtime expects from its host.
 */
export const hostTool = (name: string): ToolName => name as ToolName;

export interface BaseStateBase {
	messages: ChatCompletionMessageParam[];
	response?: string;
	outputMessages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export type SystemPlacement = "append" | "top" | "replace";

export interface NormalizeChatMessageOptions {
	placement?: SystemPlacement;
}
