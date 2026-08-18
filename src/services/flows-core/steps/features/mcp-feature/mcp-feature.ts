import {
	GraphBase,
	type GraphTool,
} from "@/services/flows-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-core/interfaces/engine/messages";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-core/interfaces/engine/step";
import {
	bindStep,
	defineStep,
} from "@/services/flows-core/interfaces/engine/step";
import { stepRegistry } from "@/services/flows-core/registries/step-registry";
import { adaptMCPTool } from "@/services/flows-core/steps/features/mcp-feature/mcp-tool-adapter";
import type {
	MCPFeatureConfig,
	MCPServerConfig,
} from "@/services/flows-core/steps/features/mcp-feature/types";
import {
	MultiServerMCPClient,
	type StreamableHTTPConnection,
} from "@/services/flows-core/utils/langchain-mcp-adapter/index";
import { logError, logInfo } from "@/services/flows-core/utils/logger";

const STEP_NAME = "mcp-feature" as const;
export const MCP_FEATURE_NAME = STEP_NAME;

export interface MCPFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface MCPFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export type { MCPFeatureConfig, MCPServerConfig };

export const MCP_FEATURE_TOOLS: readonly string[] = [];

export const MCP_FEATURE_DESCRIPTION =
	"Connect external MCP (Model Context Protocol) servers and expose their tools to the agent.";

const buildClientServersConfig = (
	servers: MCPServerConfig[],
): Record<string, StreamableHTTPConnection> =>
	Object.fromEntries(
		servers.map((server) => {
			const conn: StreamableHTTPConnection = {
				type: server.type,
				url: server.url,
				...(server.headers ? { headers: server.headers } : {}),
			};
			return [server.name, conn];
		}),
	);

/**
 * Connected MCP clients, keyed by the exact server set they were opened for.
 *
 * A run used to build a client, handshake every server, list its tools and close
 * it again — so every chat message paid a full round trip to each remote server
 * before the model saw a single token, and a server answering 4xx paid three
 * (HTTP, then the SSE fallback, then the /sse URL fallback). Sessions outlive the
 * run now and are reused by the next one; an idle set is closed on a timer so a
 * long-lived offscreen document does not hold sockets open forever.
 */
interface CachedMCPSession {
	client: MultiServerMCPClient;
	tools: ReturnType<typeof adaptMCPTool>[];
	idleTimer: ReturnType<typeof setTimeout> | null;
}

const MCP_SESSION_IDLE_MS = 5 * 60_000;
// A session that produced no tools is remembered only briefly: long enough that
// a broken server cannot re-run its fallback chain on every message, short
// enough that fixing the credential takes effect on the next turn or two.
const MCP_FAILED_SESSION_TTL_MS = 30_000;

const mcpSessions = new Map<string, CachedMCPSession>();

// Servers are matched on everything that changes what the session reaches: a
// re-minted Composio URL or a rotated key must open a new session, not reuse one.
const sessionKey = (servers: MCPServerConfig[]): string =>
	JSON.stringify(
		[...servers]
			.map((server) => ({
				name: server.name,
				type: server.type,
				url: server.url,
				headers: Object.entries(server.headers ?? {}).sort(([a], [b]) =>
					a.localeCompare(b),
				),
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
	);

const touchSession = (key: string, session: CachedMCPSession): void => {
	if (session.idleTimer) clearTimeout(session.idleTimer);
	const ttl =
		session.tools.length > 0 ? MCP_SESSION_IDLE_MS : MCP_FAILED_SESSION_TTL_MS;
	session.idleTimer = setTimeout(() => {
		mcpSessions.delete(key);
		void session.client.close().catch((error) => {
			logError("[MCP_FEATURE] Failed to close an idle MCP session:", error);
		});
	}, ttl);
};

const openSession = async (
	servers: MCPServerConfig[],
	key: string,
): Promise<CachedMCPSession> => {
	const client = new MultiServerMCPClient({
		mcpServers: buildClientServersConfig(servers),
		throwOnLoadError: false,
		// Two servers exposing a common name (`search`, `fetch`) would otherwise
		// collide and silently shadow each other.
		prefixToolNameWithServerName: true,
		// Previously "ignore" — a dead server left no trace anywhere, so the
		// Connections UI had no error to show and the user saw silent no-ops.
		onConnectionError: ({ serverName, error }) => {
			logError(`[MCP_FEATURE] Server "${serverName}" failed:`, error);
		},
	});

	await client.initializeConnections();
	const tools = (await client.getTools()).map(adaptMCPTool);
	return { client, tools, idleTimer: null };
};

/**
 * The tools for `servers`, from a live session where one exists.
 *
 * A failed session is cached too: a server that cannot be reached would
 * otherwise repeat its whole connect-and-fall-back sequence on every single
 * message, which is the slowest possible way to contribute nothing.
 */
const getSessionTools = async (
	servers: MCPServerConfig[],
): Promise<ReturnType<typeof adaptMCPTool>[]> => {
	const key = sessionKey(servers);
	const cached = mcpSessions.get(key);
	if (cached) {
		touchSession(key, cached);
		return cached.tools;
	}

	let session: CachedMCPSession;
	try {
		session = await openSession(servers, key);
	} catch (error) {
		logError("[MCP_FEATURE] Failed to open an MCP session:", error);
		session = {
			client: {
				close: async () => undefined,
			} as unknown as MultiServerMCPClient,
			tools: [],
			idleTimer: null,
		};
	}

	mcpSessions.set(key, session);
	touchSession(key, session);
	return session.tools;
};

const buildSystemPrompt = (
	toolNames: Array<{ name: string; description: string }>,
	serverNames: string[],
): string => {
	const serverList = serverNames.join(", ");
	const toolList = toolNames
		.map((t) => `- ${t.name}: ${t.description || "(no description)"}`)
		.join("\n");
	return `# MCP TOOLS (${serverList})
You have access to external tools provided via MCP servers: ${serverList}.

## AVAILABLE MCP TOOLS
${toolList || "(no tools loaded)"}

Use these tools when they are the best fit for the task at hand.`;
};

const definition = defineStep<
	MCPFeatureInput,
	MCPFeatureOutput,
	undefined,
	MCPFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config }) => {
		try {
			const servers = config?.servers ?? [];
			if (servers.length === 0) {
				return { output: { tools: input.tools, messages: input.messages } };
			}

			const sessionTools = await getSessionTools(servers);

			const allowlist = new Set(config?.toolAllowlist ?? []);
			const mcpBaseTools = sessionTools.filter(
				(tool) => allowlist.size === 0 || allowlist.has(tool.name),
			);
			const serverNames = servers.map((s) => s.name);

			// The one line that proves the model's toolbox actually received these.
			// Everything upstream (a green dot, a tool count in the sidebar) can be
			// right while this is empty, so it is logged unconditionally.
			logInfo(
				`[MCP_FEATURE] ${mcpBaseTools.length} tool(s) from ${serverNames.join(", ") || "no server"}:`,
				mcpBaseTools.map((tool) => tool.name).join(", ") || "(none)",
			);

			const messages = GraphBase.chat.systemMessage(
				input.messages,
				buildSystemPrompt(mcpBaseTools, serverNames),
			);

			return {
				output: {
					tools: GraphBase.chat.addTool(input.tools, ...mcpBaseTools),
					messages,
				},
			};
		} catch (error) {
			logError("[MCP_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
				},
			};
		}
	},
});

type MCPFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createMCPFeatureStep = (
	_services?: undefined,
	config?: MCPFeatureConfig,
): BoundStep<MCPFeatureInput, MCPFeatureOutput> =>
	bindStep(definition, undefined, config);

stepRegistry.register(STEP_NAME, createMCPFeatureStep, {
	description: MCP_FEATURE_DESCRIPTION,
	configParams: [
		{
			key: "servers",
			type: "array",
			default: [],
			description:
				"Resolved MCP servers (filled from `connections` at run time)",
		},
		{
			key: "connections",
			type: "array",
			default: [],
			description: "References into the Connections registry",
		},
		{
			key: "toolAllowlist",
			type: "array",
			default: [],
			description:
				"Server-prefixed tool names the agent may use; empty exposes all",
		},
	],
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: "step-mcp-feature",
		type: "feature",
		// Both graphs expose `messages` and `tools`, which is all this step reads.
		// Restricting it to `foundation` meant a Simple Agent preset had no MCP
		// step at all, so a chosen connection could never reach the model.
		graphTypes: ["foundation", "agent"],
		inputs: [
			{
				name: "messages",
				type: "Message[]",
				required: true,
				description: "Current chat messages",
			},
			{
				name: "tools",
				type: "Tool[]",
				required: true,
				description: "Current available tools",
			},
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages with MCP tool instructions.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with dynamically loaded MCP tools.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: MCPFeatureSpec;
	}
}
