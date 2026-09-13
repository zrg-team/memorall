/**
 * Shared vocabulary for the Connections registry.
 *
 * A "connection" is one credential the user manages — a Composio account, a
 * local server they run, or a raw MCP endpoint. Agents reference connections by
 * id and narrow the exposed tools per agent; nothing about a connection is
 * duplicated into agent config.
 */

export type ConnectionKind = "composio" | "template" | "custom";

/** `stdio` is a local process the desktop app starts; it has no URL. */
export type ConnectionTransport = "http" | "sse" | "stdio";

/**
 * How the endpoint is authenticated. Anything but `none` stores its value as an
 * encrypted secret under `secretRef` — never inline in the registry, which is
 * plain JSON in the `configurations` table.
 */
export type ConnectionAuthMode = "none" | "bearer" | "header" | "query";

export type ConnectionAppStatus = "active" | "pending" | "expired";

/** A Composio toolkit the user has authorized (Gmail, Slack, …). */
export interface ConnectionApp {
	/** Composio toolkit slug, e.g. "gmail". */
	id: string;
	name: string;
	/**
	 * Square brand mark, as Composio reported it. Optional: apps recorded before
	 * this field existed fall back to deriving the URL from the slug.
	 */
	logo?: string;
	connectedAccountId?: string;
	status: ConnectionAppStatus;
	/** Unprefixed tool names this app contributes. Empty means "all". */
	toolAllowlist?: string[];
}

export interface ComposioConnectionDetail {
	/** Sessions scoped to a subset of apps, keyed by the sorted toolkit list. */
	scopedSessions?: Record<string, string>;
	/** Tool-router session backing the MCP endpoint. Re-minted when scoping changes. */
	sessionId?: string;
	toolkits: string[];
}

/**
 * A local MCP server (`kind: "template"`, `transport: "stdio"`): a command the
 * desktop app starts on the user's behalf, from a template or typed in.
 */
export interface StdioConnectionDetail {
	command: string;
	args: string[];
	cwd?: string;
	/** Non-secret environment. */
	env?: Record<string, string>;
	/**
	 * Environment variables whose values are secrets. The values live in one
	 * encrypted JSON record under `secretRef`, never in the registry.
	 */
	secretEnvKeys?: string[];
	/** Set when the connection came from a template, so it can be edited as one. */
	templateId?: string;
	/** Non-secret template field values, for editing. */
	templateValues?: Record<string, string>;
}

export interface McpConnection {
	id: string;
	kind: ConnectionKind;
	name: string;
	transport: ConnectionTransport;
	url: string;
	authMode: ConnectionAuthMode;
	/** Header name for `header` auth (e.g. "X-Api-Key"). */
	authHeaderName?: string;
	/** Query parameter name for `query` auth. */
	authQueryParam?: string;
	/** Encryption record key holding the credential, e.g. `mcp_secret_<id>`. */
	secretRef?: string;
	/** Non-secret headers. Credentials never belong here. */
	headers?: Record<string, string>;
	apps?: ConnectionApp[];
	composio?: ComposioConnectionDetail;
	stdio?: StdioConnectionDetail;
	/**
	 * Connection-level tool scope, as server-prefixed names (`gmail__send_email`).
	 * Undefined means every discovered tool.
	 */
	toolAllowlist?: string[];
	enabledByDefault: boolean;
	disabled?: boolean;
	createdAt: string;
	updatedAt: string;
}

/** What an agent stores: a reference plus its own narrowing. */
export interface AgentConnectionSelection {
	connectionId: string;
	/** Composio only — which apps this agent may reach. */
	appIds?: string[];
	/** Per-agent narrowing, server-prefixed names. Undefined inherits the connection. */
	toolAllowlist?: string[];
}

export interface ConnectionRegistry {
	version: 1;
	connections: McpConnection[];
}

export interface CachedToolDescriptor {
	name: string;
	exposedName: string;
	description: string;
	readOnly?: boolean;
	destructive?: boolean;
}

export interface ToolCacheEntry {
	descriptors: CachedToolDescriptor[];
	discoveredAt: string;
	error?: string;
}

export interface ToolCache {
	version: 1;
	entries: Record<string, ToolCacheEntry>;
}

export const CONNECTIONS_CONFIG_KEY = "mcp.connections";
export const TOOL_CACHE_CONFIG_KEY = "mcp.tool-cache";

export const EMPTY_REGISTRY: ConnectionRegistry = {
	version: 1,
	connections: [],
};

export const EMPTY_TOOL_CACHE: ToolCache = { version: 1, entries: {} };

/** Encryption record key for a connection's credential. */
export const connectionSecretRef = (connectionId: string): string =>
	`mcp_secret_${connectionId}`;

export const COMPOSIO_SECRET_KEY = "composio_config";

/** Composio scopes connected accounts per user id; one local user, one id. */
export const COMPOSIO_USER_ID = "memorall-local";

/**
 * The fixed meta-tools every Composio tool-router session exposes, whatever
 * apps it reaches. Each carries a long description the model pays for on every
 * request, so which of them an agent sees is worth choosing.
 */
export const COMPOSIO_ROUTER_TOOLS = [
	"COMPOSIO_SEARCH_TOOLS",
	"COMPOSIO_GET_TOOL_SCHEMAS",
	"COMPOSIO_MULTI_EXECUTE_TOOL",
	"COMPOSIO_MANAGE_CONNECTIONS",
	"COMPOSIO_REMOTE_BASH_TOOL",
	"COMPOSIO_REMOTE_WORKBENCH",
] as const;

/**
 * The three that make up the search → schema → execute loop, which is all an
 * agent needs to reach any app tool. The other three are opt-in: connections
 * are managed from the Connections page rather than by the agent, and the
 * remote sandbox pair is destructive, heavy to describe, and rarely wanted.
 */
export const COMPOSIO_RECOMMENDED_TOOLS = [
	"COMPOSIO_SEARCH_TOOLS",
	"COMPOSIO_GET_TOOL_SCHEMAS",
	"COMPOSIO_MULTI_EXECUTE_TOOL",
] as const;
