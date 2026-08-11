import {
  HarnessError,
  MODEL_SERVICE,
  assertJsonValue,
  executeTool,
  serializeHarnessError,
  throwIfCancelled,
  toolSchemaToJsonSchema,
  type BaseTool,
  type HarnessGraphDefinition,
  type HarnessGraphExecutionContext,
  type HarnessUsage,
  type JsonValue,
  type ModelMessage,
  type ModelToolCall,
  type ToolExecutionResult,
} from "@memorall/agent-harness-core";

export interface AgentGraphInput {
  messages: readonly ModelMessage[];
  tools?: readonly string[];
  model?: string;
  systemPrompt?: string;
}

export interface AgentGraphOptions {
  id?: string;
  version?: string;
  description?: string;
  tools?: readonly string[];
  model?: string;
  systemPrompt?: string;
  maxRetries?: number;
}

interface PreparedCall {
  call: ModelToolCall;
  tool?: BaseTool;
}

const parseInput = (value: unknown): AgentGraphInput => {
  if (!value || typeof value !== "object" || !Array.isArray((value as AgentGraphInput).messages)) {
    throw new HarnessError("invalid_request", "Agent graph input requires a messages array");
  }
  return value as AgentGraphInput;
};

const parseArguments = (value: string): unknown => {
  try {
    return value.trim() ? JSON.parse(value) : {};
  } catch (error) {
    throw new HarnessError("invalid_request", "Tool arguments are not valid JSON", {
      cause: error,
      details: { arguments: value },
    });
  }
};

const truncateResult = (result: ToolExecutionResult, maxBytes: number): ToolExecutionResult => {
  const bytes = new TextEncoder().encode(result.content);
  if (bytes.byteLength <= maxBytes) return result;
  let content = result.content;
  while (content.length > 0 && new TextEncoder().encode(content).byteLength > maxBytes) {
    content = content.slice(0, Math.max(0, content.length - Math.ceil(content.length / 10)));
  }
  return {
    ...result,
    content,
    meta: { ...(result.meta ?? {}), truncated: true },
  };
};

const toToolMessageContent = (result: ToolExecutionResult): string => {
  if (result.structuredContent === undefined) return result.content;
  const structured = JSON.stringify(result.structuredContent);
  return result.content.trim() && result.content.trim() !== structured
    ? `${result.content}\n\n${structured}`
    : structured;
};

const executePreparedCall = async (
  prepared: PreparedCall,
  context: HarnessGraphExecutionContext,
  messages: readonly ModelMessage[],
  maxRetries: number,
): Promise<{ message: ModelMessage; result: ToolExecutionResult }> => {
  const { call, tool } = prepared;
  const startedAt = context.platform.now();
  await context.events.emit({
    type: "tool.started",
    runId: context.runId,
    callId: call.id,
    tool: call.name,
    timestamp: startedAt,
  });
  let result: ToolExecutionResult;
  try {
    if (!tool) throw new HarnessError("tool_not_found", `Tool is not registered: ${call.name}`);
    for (const token of tool.requiredServices ?? []) context.services.get(token);
    result = await executeTool(
      tool,
      parseArguments(call.arguments),
      {
        runId: context.runId,
        operationId: call.id,
        signal: context.signal,
        deadlineMs: context.deadlineMs,
        scope: context.scope,
        state: messages,
        runtime: context.runtime,
        services: context.services,
        platform: context.platform,
      },
      { maxRetries },
    );
  } catch (error) {
    const errorPayload = { error: serializeHarnessError(error) };
    assertJsonValue(errorPayload, "Tool error payload");
    result = {
      content: `Tool ${call.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
      structuredContent: errorPayload,
      meta: { operationId: call.id },
    };
  }
  result = truncateResult(result, context.limits.maxToolOutputBytes);
  const completedAt = context.platform.now();
  await context.events.emit({
    type: "tool.completed",
    runId: context.runId,
    callId: call.id,
    tool: call.name,
    result,
    timestamp: completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
  });
  return {
    result,
    message: {
      role: "tool",
      content: toToolMessageContent(result),
      toolCallId: call.id,
      name: call.name,
    },
  };
};

const executeCalls = async (
  calls: readonly PreparedCall[],
  context: HarnessGraphExecutionContext,
  messages: readonly ModelMessage[],
  maxRetries: number,
): Promise<Array<{ message: ModelMessage; result: ToolExecutionResult }>> => {
  const parallel =
    context.limits.maxConcurrentTools > 1 &&
    calls.every(({ tool }) => tool?.annotations?.parallelSafeHint === true);
  if (!parallel) {
    const results = [];
    for (const call of calls) {
      results.push(await executePreparedCall(call, context, messages, maxRetries));
    }
    return results;
  }
  const results = [];
  for (let index = 0; index < calls.length; index += context.limits.maxConcurrentTools) {
    results.push(
      ...(await Promise.all(
        calls
          .slice(index, index + context.limits.maxConcurrentTools)
          .map((call) => executePreparedCall(call, context, messages, maxRetries)),
      )),
    );
  }
  return results;
};

const mergeUsage = (current: HarnessUsage, next: HarnessUsage): HarnessUsage => ({
  inputTokens: current.inputTokens + next.inputTokens,
  outputTokens: current.outputTokens + next.outputTokens,
  totalTokens: current.totalTokens + next.totalTokens,
});

export const createAgentGraph = (options: AgentGraphOptions = {}): HarnessGraphDefinition => ({
  id: options.id ?? "agent",
  version: options.version ?? "1.0.0",
  description: options.description ?? "Provider-neutral ReAct agent graph",
  requiredServices: [MODEL_SERVICE],
  execute: async (context) => {
    const input = parseInput(context.input);
    const model = context.services.get(MODEL_SERVICE);
    const selectedToolNames = input.tools ?? options.tools ?? [];
    const tools = selectedToolNames.map((name) => context.tools.create(name, context.services));
    const modelTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolSchemaToJsonSchema(tool.schema),
    }));
    const messages: ModelMessage[] = [...input.messages];
    const systemPrompt = input.systemPrompt ?? options.systemPrompt;
    if (systemPrompt) messages.unshift({ role: "system", content: systemPrompt });
    let usage: HarnessUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    for (let iteration = 0; iteration < context.limits.maxIterations; iteration += 1) {
      throwIfCancelled(context.signal, context.deadlineMs, () => context.platform.now());
      const toolCalls = new Map<number, ModelToolCall>();
      let completed: ModelMessage | undefined;
      for await (const event of model.stream({
        model: input.model ?? options.model,
        messages: [...messages],
        tools: modelTools,
        parallelToolCalls:
          context.limits.maxConcurrentTools > 1 &&
          tools.length > 0 &&
          tools.every(({ annotations }) => annotations?.parallelSafeHint === true),
        signal: context.signal,
      })) {
        throwIfCancelled(context.signal, context.deadlineMs, () => context.platform.now());
        if (event.type === "text.delta") {
          await context.events.emit({
            type: "model.delta",
            runId: context.runId,
            delta: { type: event.type, text: event.text },
            timestamp: context.platform.now(),
          });
        } else if (event.type === "tool.delta") {
          const existing = toolCalls.get(event.index) ?? { id: "", name: "", arguments: "" };
          toolCalls.set(event.index, {
            id: event.id ?? existing.id,
            name: event.name ?? existing.name,
            arguments: `${existing.arguments}${event.arguments ?? ""}`,
          });
          await context.events.emit({
            type: "model.delta",
            runId: context.runId,
            delta: {
              type: event.type,
              index: event.index,
              ...(event.id ? { id: event.id } : {}),
              ...(event.name ? { name: event.name } : {}),
              ...(event.arguments ? { arguments: event.arguments } : {}),
            },
            timestamp: context.platform.now(),
          });
        } else if (event.type === "usage") {
          usage = mergeUsage(usage, event);
          await context.events.emit({
            type: "usage.updated",
            runId: context.runId,
            usage,
            timestamp: context.platform.now(),
          });
        } else {
          completed = event.message;
        }
      }

      if (!completed) {
        throw new HarnessError("transport_error", "Model stream ended without a completed message", {
          retryable: true,
        });
      }
      const completedCalls = completed.toolCalls ?? [...toolCalls.values()];
      const assistant: ModelMessage = {
        role: "assistant",
        content: completed.content,
        ...(completedCalls.length ? { toolCalls: completedCalls } : {}),
      };
      messages.push(assistant);
      if (completedCalls.length === 0) {
        const output = {
          messages,
          response: typeof completed.content === "string" ? completed.content : "",
          usage,
        };
        assertJsonValue(output, "Agent graph result");
        const checkpointState = { messages };
        assertJsonValue(checkpointState, "Agent checkpoint state");
        return { output, checkpointState };
      }

      const prepared = completedCalls.map((call) => ({
        call,
        tool: tools.find(({ name }) => name === call.name),
      }));
      const results = await executeCalls(prepared, context, messages, options.maxRetries ?? 0);
      messages.push(...results.map(({ message }) => message));
    }
    throw new HarnessError("resource_limit", "Agent exceeded the maximum iteration count", {
      details: { maxIterations: context.limits.maxIterations },
    });
  },
});
