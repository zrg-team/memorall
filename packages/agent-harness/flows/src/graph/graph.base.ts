import {
	Annotation,
	END,
	START,
	StateGraph,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type {
	ChatCompletionContentPart,
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionToolMessageParam,
	ChatCompletionTool,
} from "../interfaces/engine/messages.js";
import {
	convertToolsToOpenAI,
	convertToolToOpenAI,
} from "../registries/tool-registry.js";
import type {
	BaseTool,
	ToolBinding,
} from "../interfaces/engine/tool.js";
import {
	defaultRegistries,
	type FlowRegistrySet,
} from "../registries/registry-set.js";

import { logWarn } from "../utils/logger.js";
import {
	FLOW_RUN_LIFECYCLE_CONFIG_KEY,
	createFlowRunLifecycle,
	getFlowRunLifecycle,
	toNode,
	type FlowRunFinishCallback,
	type FlowRunLifecycle,
} from "../runtime/run-lifecycle.js";
import {
	getEnabledSteps,
	type UnifiedFlowConfig,
} from "../interfaces/config/flow-config.js";

const isRawBaseTool = (tool: unknown): tool is BaseTool =>
	typeof tool === "object" && tool !== null && "execute" in tool;

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
 * model a host-provided capability — Memorall's artifact renderer, its image
 * fetcher — cannot name it and still typecheck. Reaching for the host's own
 * declaration inverts the dependency: the runtime would need its consumer to
 * exist before it compiles, which is exactly what stops this code from being a
 * package.
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

export const MISSING_TOOL_CALL_RESULT_CONTENT = "Error: Tool call error.";

const getSystemContent = (message: ChatCompletionMessageParam): string => {
	if (typeof message.content === "string") {
		return message.content.trim();
	}
	if (Array.isArray(message.content)) {
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => (part as { type: "text"; text: string }).text)
			.join("\n")
			.trim();
	}
	return "";
};

export const messageContentToText = (
	content:
		| ChatCompletionMessageParam["content"]
		| ChatCompletionToolMessageParam["content"]
		| null
		| undefined,
): string => {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: ChatCompletionContentPart) =>
			part.type === "text" ? part.text : `[${part.type}]`,
		)
		.join("\n");
};

export const outputMessagesToText = (
	messages: ChatCompletionMessageParam[],
): string =>
	messages
		.filter((message) => message.role === "assistant")
		.map((message) => messageContentToText(message.content))
		.filter(Boolean)
		.join("\n\n");

export const buildResponseFromOutputMessages = (
	currentMessages: ChatCompletionMessageParam[] | undefined,
	nextMessages: ChatCompletionMessageParam[],
): string =>
	outputMessagesToText([...(currentMessages ?? []), ...nextMessages]);

const normalizeAssistantMessage = (
	message: Extract<ChatCompletionMessageParam, { role: "assistant" }>,
): ChatCompletionMessageParam => {
	if (message.tool_calls?.length) {
		return message;
	}

	const { tool_calls: _toolCalls, ...messageWithoutToolCalls } = message;
	return messageWithoutToolCalls;
};

export const cleanToolMessageSequence = (
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] => {
	const toolById = new Map<string, ChatCompletionToolMessageParam[]>();

	for (const message of messages) {
		if (message.role !== "tool") continue;
		if (!message.tool_call_id) continue;
		const bucket = toolById.get(message.tool_call_id) ?? [];
		bucket.push(message);
		toolById.set(message.tool_call_id, bucket);
	}

	const ordered: ChatCompletionMessageParam[] = [];
	for (const message of messages) {
		if (message.role === "tool") {
			continue;
		}

		if (message.role !== "assistant" || !message.tool_calls?.length) {
			ordered.push(
				message.role === "assistant"
					? normalizeAssistantMessage(message)
					: message,
			);
			continue;
		}

		const resolvedToolCallIds = new Set(
			message.tool_calls
				.filter(({ id }) => (toolById.get(id)?.length ?? 0) > 0)
				.map(({ id }) => id),
		);

		if (resolvedToolCallIds.size === 0) {
			continue;
		}

		ordered.push(message);
		for (const toolCall of message.tool_calls) {
			const bucket = toolById.get(toolCall.id);
			const toolMessage = bucket?.shift();
			if (toolMessage) {
				ordered.push(toolMessage);
				if (bucket?.length === 0) {
					toolById.delete(toolCall.id);
				}
				continue;
			}

			if (message.tool_calls.length > 1) {
				ordered.push({
					role: "tool",
					content: MISSING_TOOL_CALL_RESULT_CONTENT,
					tool_call_id: toolCall.id,
				});
			}
		}
	}

	return ordered;
};

export const appendOutputMessagesToState = <TState extends BaseStateBase>(
	state: TState,
	...messages: ChatCompletionMessageParam[]
): TState => {
	state.outputMessages.push(...messages);
	return state;
};

export const appendAssistantOutputToState = <TState extends BaseStateBase>(
	state: TState,
	content: string | null | undefined,
): TState => {
	if (!content || messageContentToText(content).trim().length === 0) {
		return state;
	}

	return appendOutputMessagesToState(state, {
		role: "assistant",
		content,
	});
};

export const createOutputMessageChunks = (
	messages: ChatCompletionMessageParam[],
): ChatCompletionChunk[] => {
	const chunks: ChatCompletionChunk[] = [];

	for (const message of messages) {
		if (message.role !== "assistant" && message.role !== "tool") continue;
		const content = messageContentToText(message.content);
		if (
			message.role === "assistant" &&
			!content &&
			!message.tool_calls?.length
		) {
			continue;
		}
		chunks.push({
			id: `chunk-${Date.now()}-${crypto.randomUUID()}`,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: "",
			choices: [
				{
					index: 0,
					delta: {
						role: message.role,
						content,
						...(message.role === "assistant" && message.tool_calls?.length
							? {
									tool_calls: message.tool_calls.map((toolCall, index) => ({
										index,
										id: toolCall.id,
										type: toolCall.type,
										function: { ...toolCall.function },
									})),
								}
							: {}),
						...(message.role === "tool"
							? { tool_call_id: message.tool_call_id }
							: {}),
					},
					finish_reason: null,
				},
			],
		});
	}

	return chunks;
};

export const normalizeChatMessages = (
	messages: ChatCompletionMessageParam[] | undefined,
	systemContent?: string,
	options?: NormalizeChatMessageOptions,
): ChatCompletionMessageParam[] => {
	const list = Array.isArray(messages) ? messages : [];
	const systemMessages = list.filter((m) => m.role === "system");
	const nonSystem = list.filter((m) => m.role !== "system");
	const placement = options?.placement ?? "append";
	const ordered = cleanToolMessageSequence(nonSystem);

	const existingSystemParts = systemMessages
		.map((message) => getSystemContent(message))
		.filter(Boolean);
	const newSystemContent = systemContent?.trim();
	let systemParts: string[] = [];

	if (placement === "replace") {
		systemParts = newSystemContent ? [newSystemContent] : [];
	} else if (placement === "top") {
		systemParts = [newSystemContent, ...existingSystemParts].filter(
			Boolean,
		) as string[];
	} else {
		systemParts = [...existingSystemParts, newSystemContent].filter(
			Boolean,
		) as string[];
	}

	if (systemParts.length === 0) {
		return ordered;
	}

	return [{ role: "system", content: systemParts.join("\n\n") }, ...ordered];
};

export const BaseAnnotation = {
	messages: Annotation<ChatCompletionMessageParam[]>({
		value: (x, y) => normalizeChatMessages(y ?? x),
		default: () => [],
	}),
	response: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	outputMessages: Annotation<ChatCompletionMessageParam[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	tools: Annotation<GraphTool[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
};

const getGraphToolName = (tool: GraphTool): string =>
	typeof tool === "string" ? tool : tool.name;

function addTool(current: ToolName[], ...tools: ToolName[]): ToolName[];
function addTool(current: GraphTool[], ...tools: GraphTool[]): GraphTool[];
function addTool(current: GraphTool[], ...tools: GraphTool[]): GraphTool[] {
	const next = [...current];
	for (const tool of tools) {
		const name = getGraphToolName(tool);
		const existingIndex = next.findIndex(
			(candidate) => getGraphToolName(candidate) === name,
		);
		if (existingIndex >= 0) {
			next[existingIndex] = tool;
			continue;
		}
		next.push(tool);
	}
	return next;
}

const createChatHelpers = (registries: FlowRegistrySet) => ({
	getToolName: (tool: GraphTool): ToolName =>
		getGraphToolName(tool) as ToolName,
	systemMessage: (
		messages: ChatCompletionMessageParam[],
		systemContent: string,
		options?: NormalizeChatMessageOptions,
	): ChatCompletionMessageParam[] =>
		normalizeChatMessages(messages, systemContent, options),
	assistantMessage: (
		messages: ChatCompletionMessageParam[],
		content: string | null,
		tool_calls?: ChatCompletionMessageToolCall[],
	): ChatCompletionMessageParam[] => [
		...messages,
		{
			role: "assistant",
			content,
			tool_calls,
		},
	],
	toolMessage: (
		messages: ChatCompletionMessageParam[],
		tool_call_id: string,
		content: ChatCompletionToolMessageParam["content"],
	): ChatCompletionMessageParam[] => [
		...messages,
		{
			role: "tool",
			content,
			tool_call_id,
		},
	],
	lastMessage: (messages: ChatCompletionMessageParam[]) =>
		messages[messages.length - 1],
	getToolCallMessage: (
		messages: ChatCompletionMessageParam[],
		toolCallId: string,
	) =>
		messages.find(
			(message) =>
				message.role === "tool" && message.tool_call_id === toolCallId,
		),
	injectUserContext: (
		messages: ChatCompletionMessageParam[],
		content: string,
	): ChatCompletionMessageParam[] => {
		const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
		if (lastUserIdx === -1) return messages;
		const lastUser = messages[lastUserIdx];
		if (!lastUser) return messages;
		const updated = [...messages];
		updated[lastUserIdx] = (
			typeof lastUser.content === "string"
				? { ...lastUser, content: `${lastUser.content}\n\n${content}` }
				: {
						...lastUser,
						content: [
							...((lastUser.content as ChatCompletionContentPart[]) ?? []),
							{ type: "text" as const, text: content },
						],
					}
		) as ChatCompletionMessageParam;
		return updated;
	},
	addTool,
	removeTool: (current: GraphTool[], ...names: ToolName[]): GraphTool[] =>
		current.filter(
			(tool) => !names.includes(getGraphToolName(tool) as ToolName),
		),
	replaceTool: (
		current: GraphTool[],
		oldName: ToolName,
		newTool: GraphTool,
	): GraphTool[] =>
		current.map((tool) =>
			getGraphToolName(tool) === oldName ? newTool : tool,
		),
	clearTools: (): GraphTool[] => [],
	combineTools: (
		toolNames: readonly GraphTool[],
		services?: unknown,
	): CombinedTool[] => {
		return toolNames.map((tool): CombinedTool => {
			if (isRawBaseTool(tool)) {
				return { executor: tool, tool: convertToolToOpenAI(tool) };
			}
			const executor =
				typeof tool === "string"
					? registries.tools.getToolByName(tool, services)
					: registries.tools.getToolByName(
							(tool as ConfiguredGraphTool).name,
							services,
							(tool as ConfiguredGraphTool).config,
						);
			return { executor, tool: convertToolToOpenAI(executor) };
		});
	},
});

export type GraphChatHelpers = ReturnType<typeof createChatHelpers>;

// Proper LangGraph types
type CompiledGraph<T> = ReturnType<
	StateGraph<T, T, unknown, string | typeof START | typeof END>["compile"]
>;
type LangGraphInvokeResult<T> = ReturnType<CompiledGraph<T>["invoke"]>;
type LangGraphStreamResult<T> = ReturnType<CompiledGraph<T>["stream"]>;
type LangGraphInvokeOptions<T> = Parameters<CompiledGraph<T>["invoke"]>[1];
type LangGraphStreamOptions<T> = Parameters<CompiledGraph<T>["stream"]>[1];
type LangGraphStreamValue<T> = Awaited<LangGraphStreamResult<T>>;

const wrapStreamWithLifecycle = <TStream extends AsyncIterable<unknown>>(
	stream: TStream,
	onDrain: () => Promise<void>,
): TStream => {
	let drained = false;

	const drainOnce = async (): Promise<void> => {
		if (drained) {
			return;
		}
		drained = true;
		await onDrain();
	};

	const createIterator = (): AsyncIterator<unknown> => {
		const iterator = stream[Symbol.asyncIterator]();

		return {
			next: async (value?: unknown) => {
				try {
					const result = await iterator.next(value);
					if (result.done) {
						await drainOnce();
					}
					return result;
				} catch (error) {
					await drainOnce();
					throw error;
				}
			},
			return: async (value?: unknown) => {
				try {
					if (typeof iterator.return === "function") {
						return await iterator.return(value);
					}
					return {
						done: true,
						value,
					};
				} finally {
					await drainOnce();
				}
			},
			throw: async (error?: unknown) => {
				try {
					if (typeof iterator.throw === "function") {
						return await iterator.throw(error);
					}
					throw error;
				} finally {
					await drainOnce();
				}
			},
		};
	};

	return new Proxy(stream as object, {
		get(target, property, receiver) {
			if (property === Symbol.asyncIterator) {
				return createIterator;
			}

			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as TStream;
};

/**
 * Build a step input object by picking state fields according to the declared mapping.
 * e.g. mapping = { messages: "messages", graphId: "graphId" }
 *   → { messages: state.messages, graphId: state.graphId }
 */
function buildMappedInput(
	state: Record<string, unknown>,
	mapping: Record<string, string>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(mapping).map(([inputKey, stateKey]) => [
			inputKey,
			state[stateKey],
		]),
	);
}

export class GraphBase<N extends string, T extends BaseStateBase, S = unknown> {
	protected workflow!: StateGraph<T, T, unknown, N | typeof START | typeof END>;
	protected app!: CompiledGraph<T>;
	protected services!: S;
	protected readonly registries: FlowRegistrySet;
	protected readonly chat: GraphChatHelpers;
	public abortController = new AbortController();

	constructor(services: S, registries: FlowRegistrySet = defaultRegistries) {
		this.services = services;
		this.registries = registries;
		this.chat = createChatHelpers(registries);
	}

	/**
	 * Merge base annotation with state annotations declared by enabled steps.
	 * Call this before `new StateGraph(...)` so the state shape is derived from
	 * the active step set rather than being hardcoded in the graph definition.
	 */
	static buildMergedAnnotation(
		baseAnnotation: Record<string, unknown>,
		config: UnifiedFlowConfig,
		registries: FlowRegistrySet = defaultRegistries,
	): Record<string, unknown> {
		const merged = { ...baseAnnotation };
		for (const step of getEnabledSteps(config)) {
			const meta = registries.steps.getMeta(step.name);
			if (meta?.stateAnnotation) {
				Object.assign(merged, meta.stateAnnotation);
			}
		}
		return merged;
	}

	static chat = createChatHelpers(defaultRegistries);

	// ---------------------------------------------------------------------------
	// Config-driven node builder
	// ---------------------------------------------------------------------------

	/**
	 * Add a LangGraph node for each enabled step in config.steps, in order.
	 *
	 * Node names use the step instance `id` (not `name`) so that duplicate
	 * step names (e.g., two "add-system" steps) produce distinct node names.
	 *
	 * The step's declared defaultStateMapping is used to auto-build mapInput.
	 * Fields absent from the mapping are expected to come from step config.
	 *
	 * @returns The ordered list of node names that were added.
	 */
	protected addStepNodes(
		workflow: StateGraph<T, T, unknown, string | typeof START | typeof END>,
		config: UnifiedFlowConfig,
		services: S,
	): string[] {
		const nodeNames: string[] = [];

		for (const stepInstance of config.steps.filter((s) => s.enabled)) {
			if (!this.registries.steps.hasStep(stepInstance.name)) {
				logWarn(
					`[GraphBase] Step "${stepInstance.name}" not found in registry, skipping`,
				);
				continue;
			}

			const meta = this.registries.steps.getMeta(stepInstance.name);
			const step = this.registries.steps.getStepByName(
				stepInstance.name,
				services,
				stepInstance.config,
				{ registries: this.registries },
			);

			// Use id as node name — safe for duplicate step names
			const nodeName = `step__${stepInstance.id}`;

			const node = step.toNode<T>({
				mapInput: meta?.defaultStateMapping
					? (state) =>
							buildMappedInput(
								state as Record<string, unknown>,
								meta.defaultStateMapping!,
							)
					: undefined,
			});

			workflow.addNode(nodeName, node);
			nodeNames.push(nodeName);
		}

		return nodeNames;
	}

	/**
	 * Add edges to chain the given node names in sequence.
	 * Accepts START and END sentinels at either end of the array.
	 *
	 * Example:
	 *   chainNodes(workflow, [START, "nodeA", "nodeB", END])
	 *   // produces: START→nodeA, nodeA→nodeB, nodeB→END
	 */
	protected chainNodes(
		workflow: StateGraph<T, T, unknown, string | typeof START | typeof END>,
		nodes: (string | typeof START | typeof END)[],
	): void {
		for (let i = 0; i < nodes.length - 1; i++) {
			workflow.addEdge(nodes[i] as string, nodes[i + 1] as string);
		}
	}

	protected getRunLifecycle(
		runConfig?: LangGraphRunnableConfig,
	): FlowRunLifecycle | undefined {
		return getFlowRunLifecycle(runConfig);
	}

	protected onFinish(
		runConfig: LangGraphRunnableConfig | undefined,
		key: string,
		callback: FlowRunFinishCallback,
	): void {
		this.getRunLifecycle(runConfig)?.onFinish(key, callback);
	}

	// fn must preserve its `this` binding — use arrow class fields or .bind(this) when passing node methods
	protected addNode(
		name: N,
		fn: (
			state: T,
			config?: LangGraphRunnableConfig,
		) => Promise<Partial<T>> | Partial<T>,
	): void {
		const asyncFn = async (
			state: T,
			config?: LangGraphRunnableConfig,
		): Promise<Partial<T>> => fn(state, config);
		this.workflow.addNode(
			name,
			toNode(
				name,
				asyncFn as unknown as (
					state: Record<string, unknown>,
					config?: LangGraphRunnableConfig,
				) => Promise<Partial<Record<string, unknown>>>,
			),
		);
	}

	private withRunLifecycle<
		TOptions extends { configurable?: object } | undefined,
	>(options: TOptions, runLifecycle: FlowRunLifecycle): TOptions {
		return {
			...(options ?? {}),
			configurable: {
				...(options?.configurable ?? {}),
				[FLOW_RUN_LIFECYCLE_CONFIG_KEY]: runLifecycle,
			},
		} as TOptions;
	}

	protected compile(
		options?: Parameters<typeof this.workflow.compile>[0],
	): CompiledGraph<T> {
		if (!this.workflow) {
			throw new Error("Workflow is not defined");
		}
		this.app = this.workflow.compile({
			...options,
		});
		return this.app;
	}

	invoke(
		input: Partial<T>,
		options?: LangGraphInvokeOptions<T>,
	): LangGraphInvokeResult<T> {
		const arg = input as Parameters<typeof this.app.invoke>[0];
		const existingLifecycle = getFlowRunLifecycle(options);
		const runLifecycle = existingLifecycle ?? createFlowRunLifecycle();
		const ownsLifecycle = !existingLifecycle;

		return (async () => {
			try {
				return await this.app.invoke(
					arg,
					this.withRunLifecycle(options, runLifecycle),
				);
			} finally {
				if (ownsLifecycle) {
					await runLifecycle.drain();
				}
			}
		})() as LangGraphInvokeResult<T>;
	}

	async stream(
		input: Partial<T>,
		options?: LangGraphStreamOptions<T>,
	): LangGraphStreamResult<T> {
		const arg = input as Parameters<typeof this.app.stream>[0];
		const existingLifecycle = getFlowRunLifecycle(options);
		const runLifecycle = existingLifecycle ?? createFlowRunLifecycle();
		const ownsLifecycle = !existingLifecycle;

		try {
			const stream = await this.app.stream(
				arg,
				this.withRunLifecycle(options, runLifecycle),
			);
			const wrappedStream = ownsLifecycle
				? wrapStreamWithLifecycle(stream as AsyncIterable<unknown>, () =>
						runLifecycle.drain(),
					)
				: stream;

			return wrappedStream as LangGraphStreamValue<T>;
		} catch (error) {
			if (ownsLifecycle) {
				await runLifecycle.drain();
			}
			throw error;
		}
	}

	getGraph() {
		return this.app.getGraph();
	}
}
