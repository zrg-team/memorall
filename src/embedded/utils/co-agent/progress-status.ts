/**
 * What the dock says it is doing.
 *
 * The bubble used to print the graph's node name verbatim — "tool executor",
 * "agent_completion" — which names the machinery rather than the work and told
 * the reader nothing about whether anything was happening. Turn the run's own
 * events into the two things worth saying: that it is thinking, or which tool it
 * is running right now.
 */

export type CoAgentProgressKind = "thinking" | "tool" | "step" | "idle";

export interface CoAgentProgress {
	kind: CoAgentProgressKind;
	/** Ready to show; already resolved to a label, never a raw node name. */
	label: string;
}

/**
 * Graph nodes that mean "the model is composing", so the reader sees one steady
 * "Thinking…" instead of internal stage names flickering past.
 */
const THINKING_NODES = new Set([
	"agent",
	"agent_completion",
	"agent-completion",
	"llm",
	"chat",
	"chat_completion",
	"chat-completion",
	"foundation",
	"generate",
	"respond",
]);

/** Nodes that are only dispatch plumbing; the tool name is the real answer. */
const TOOL_NODES = new Set(["tool_executor", "tool-executor", "tools", "tool"]);

/**
 * Plain-language names for the co-agent's own tools. Anything else falls back to
 * a humanised form of the tool name, which still beats a node id.
 */
const TOOL_LABELS: Record<string, string> = {
	co_agent_observe: "Reading the page",
	co_agent_query: "Looking at an element",
	co_agent_move: "Pointing at the page",
	co_agent_scroll: "Scrolling the page",
	co_agent_click: "Clicking",
	co_agent_input: "Typing",
	co_agent_error: "Handling a page error",
	web_search: "Searching the web",
	web_open: "Opening a page",
	web_read: "Reading a page",
	web_find_in_page: "Searching the page",
	web_dom_action: "Inspecting the page",
	web_read_images: "Looking at images",
	web_fetch_image: "Fetching an image",
	web_download: "Downloading a file",
	memory_remember: "Saving to memory",
	memory_retrieve: "Searching memory",
	knowledge_graph: "Searching knowledge",
};

export const humanizeName = (name: string): string => {
	const spaced = name.replace(/[_-]+/g, " ").trim();
	if (!spaced) return "";
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/**
 * An MCP tool's own name for itself. Its call name is `<server>__<tool>`; the
 * server's title (or the tool's name without the server) is what reads well.
 */
const mcpToolLabel = (
	toolName: string,
	toolMetadata?: Record<string, unknown>,
): string | undefined => {
	const mcp = isRecord(toolMetadata?.mcp) ? toolMetadata.mcp : undefined;
	const title = typeof mcp?.title === "string" ? mcp.title.trim() : "";
	if (title) return title;
	const original =
		typeof mcp?.originalToolName === "string" ? mcp.originalToolName : "";
	if (original) return humanizeName(original);
	const separator = toolName.indexOf("__");
	return separator > 0
		? humanizeName(toolName.slice(separator + 2))
		: undefined;
};

export const describeToolName = (
	toolName: string,
	toolMetadata?: Record<string, unknown>,
): string =>
	TOOL_LABELS[toolName] ??
	mcpToolLabel(toolName, toolMetadata) ??
	humanizeName(toolName);

const normalizeNode = (node: string): string => node.trim().toLowerCase();

/**
 * The status for a step the run just entered.
 *
 * `thinkingLabel` is passed in so the caller owns translation; this module has
 * no opinion about language.
 */
export const progressForNode = (
	node: string | undefined,
	thinkingLabel: string,
): CoAgentProgress => {
	if (!node) return { kind: "thinking", label: thinkingLabel };
	const normalized = normalizeNode(node);

	if (THINKING_NODES.has(normalized)) {
		return { kind: "thinking", label: thinkingLabel };
	}
	// A tool node on its own says nothing useful; wait for the tool name and keep
	// showing that the model is working in the meantime.
	if (TOOL_NODES.has(normalized)) {
		return { kind: "thinking", label: thinkingLabel };
	}
	return { kind: "step", label: humanizeName(node) };
};

/** The status while a specific tool is running. */
export const progressForTool = (
	toolName: string,
	toolMetadata?: Record<string, unknown>,
): CoAgentProgress => ({
	kind: "tool",
	label: describeToolName(toolName, toolMetadata),
});

/**
 * The status for a step or tool the run just started.
 *
 * A tool's start comes through the tool dispatcher's node with the tool's
 * name beside it; that name is the answer. It used to be read as the bare
 * dispatcher node and shown as "Thinking" for as long as the tool ran.
 */
export const progressForExecuteStart = (
	event: { node?: unknown; metadata?: Record<string, unknown> },
	thinkingLabel: string,
): CoAgentProgress => {
	const tool = event.metadata?.tool;
	if (typeof tool === "string" && tool.trim()) {
		const toolMetadata = isRecord(event.metadata?.tool_metadata)
			? event.metadata.tool_metadata
			: undefined;
		return progressForTool(tool.trim(), toolMetadata);
	}
	return progressForNode(
		typeof event.node === "string" ? event.node : undefined,
		thinkingLabel,
	);
};

export interface CoAgentToolExecution {
	id: string;
	name: string;
	status: string;
	toolMetadata?: Record<string, unknown>;
}

/**
 * Follows a run's tool calls as they start and finish. The status names a
 * tool for as long as one is running (the latest started, when calls run side
 * by side) and says thinking once none is, since the model reads the results
 * next. One tracker per run.
 */
export const createToolProgressTracker = (thinkingLabel: string) => {
	const running = new Map<string, CoAgentToolExecution>();
	return (execution: CoAgentToolExecution): CoAgentProgress => {
		if (execution.status === "running") {
			if (!running.has(execution.id)) running.set(execution.id, execution);
		} else {
			running.delete(execution.id);
		}
		const latest = [...running.values()].at(-1);
		return latest
			? progressForTool(latest.name, latest.toolMetadata)
			: { kind: "thinking", label: thinkingLabel };
	};
};

/**
 * The name of the tool a run is currently on: the last one it asked for.
 *
 * Tool calls stream in and accumulate, so the tail is the one in flight.
 */
export const latestToolName = (
	toolCalls: ReadonlyArray<{ function?: { name?: string } }> | undefined,
): string | undefined => {
	if (!toolCalls?.length) return undefined;
	for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
		const name = toolCalls[index]?.function?.name;
		if (typeof name === "string" && name.trim()) return name.trim();
	}
	return undefined;
};
