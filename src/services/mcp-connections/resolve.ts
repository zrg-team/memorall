/**
 * Runtime projection: registry references -> the shape `mcp-feature` already runs.
 *
 * Agents store `mcp-feature.config.connections` (ids plus per-agent narrowing).
 * The step itself still wants `servers: MCPServerConfig[]`, so this fills that in
 * just before execution, decrypting credentials on the way. Keeping the
 * projection here means the step, the graph and the flow engine are unchanged.
 *
 * Nothing in here may throw: a locked passkey or an unreachable server must
 * degrade to "that connection contributes no tools", never break a chat run.
 */

import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import {
	MCP_FEATURE_NAME,
	type MCPServerConfig,
} from "@/services/flows-legacy/steps/features/mcp-feature";
import { loadSecret } from "@/utils/master-key";
import { logWarn } from "@/utils/logger";
import { listConnections } from "./registry";
import {
	COMPOSIO_SECRET_KEY,
	type AgentConnectionSelection,
	type McpConnection,
} from "./types";

/**
 * Server key used both as the MCP client's map key and as the tool-name prefix
 * (`acme-internal__search_orders`). Derived from the display name so tool names
 * stay recognizable, with the id as a fallback and a numeric suffix on collision.
 */
export const toServerKey = (connection: McpConnection): string => {
	const slug = connection.name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || connection.id;
};

const assignUniqueKeys = (
	connections: McpConnection[],
): Map<string, string> => {
	const used = new Set<string>();
	const keys = new Map<string, string>();

	for (const connection of connections) {
		const base = toServerKey(connection);
		let key = base;
		let suffix = 2;
		while (used.has(key)) {
			key = `${base}-${suffix}`;
			suffix += 1;
		}
		used.add(key);
		keys.set(connection.id, key);
	}

	return keys;
};

const readSelections = (
	config: UnifiedFlowConfig,
): AgentConnectionSelection[] => {
	const step = config.steps.find(
		(candidate) => candidate.name === MCP_FEATURE_NAME,
	);
	const raw = step?.config?.connections;
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter(
		(entry): entry is AgentConnectionSelection =>
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as AgentConnectionSelection).connectionId === "string",
	);
};

/** The Composio project key, used to authenticate its tool-router endpoint. */
async function loadComposioApiKey(): Promise<string | null> {
	try {
		const stored = await loadSecret(COMPOSIO_SECRET_KEY);
		if (!stored) return null;
		const parsed = JSON.parse(stored) as { apiKey?: string };
		return parsed.apiKey ?? null;
	} catch {
		// Locked passkey or unreadable secret — the caller degrades gracefully.
		return null;
	}
}

/**
 * Assemble auth into headers/URL, or null when the credential can't be read.
 *
 * `secretOverride` lets the setup form test a connection before anything is
 * persisted — the typed-in token is used directly instead of being read back
 * from the encrypted store.
 */
async function applyAuth(
	connection: McpConnection,
	secretOverride?: string,
): Promise<{ url: string; headers: Record<string, string> } | null> {
	const headers: Record<string, string> = { ...(connection.headers ?? {}) };

	if (connection.authMode === "none") {
		// Composio's tool-router endpoint carries no headers in its session block
		// but is not public: unauthenticated calls get 401, which the MCP client
		// retries over SSE and reports as a misleading 404. Authenticate it with
		// the stored project key. Doing this here rather than at mint time also
		// repairs connections saved before this was understood.
		if (connection.kind === "composio") {
			const apiKey = await loadComposioApiKey();
			if (apiKey) {
				headers["x-api-key"] = apiKey;
			}
		}
		return { url: connection.url, headers };
	}

	let secret: string | null = secretOverride ?? null;

	if (!secret) {
		if (!connection.secretRef) {
			return null;
		}
		try {
			secret = await loadSecret(connection.secretRef);
		} catch (error) {
			// Locked passkey is the common case here, not a fault.
			logWarn(
				`[MCP_CONNECTIONS] Credential unavailable for "${connection.name}"; skipping.`,
				`${error}`,
			);
			return null;
		}
	}

	if (!secret) {
		return null;
	}

	switch (connection.authMode) {
		case "bearer":
			headers.Authorization = `Bearer ${secret}`;
			return { url: connection.url, headers };
		case "header":
			headers[connection.authHeaderName || "Authorization"] = secret;
			return { url: connection.url, headers };
		case "query": {
			const url = new URL(connection.url);
			url.searchParams.set(connection.authQueryParam || "key", secret);
			return { url: url.toString(), headers };
		}
		default:
			return { url: connection.url, headers };
	}
}

/**
 * Per-agent tool scope for one connection, as server-prefixed names.
 * Returns null when every tool is allowed.
 */
const resolveAllowlist = (
	connection: McpConnection,
	selection: AgentConnectionSelection,
	serverKey: string,
): string[] | null => {
	const names = selection.toolAllowlist ?? connection.toolAllowlist;
	if (names && names.length > 0) {
		return names.map((name) =>
			name.includes("__") ? name : `${serverKey}__${name}`,
		);
	}

	// Composio narrows by app: its tool slugs are toolkit-prefixed (GMAIL_*), so
	// an app selection becomes a prefix match rather than an explicit list.
	if (connection.kind === "composio" && selection.appIds?.length) {
		const allowed = new Set(selection.appIds.map((id) => id.toUpperCase()));
		const fromApps = (connection.apps ?? [])
			.filter((app) => allowed.has(app.id.toUpperCase()))
			.flatMap((app) => app.toolAllowlist ?? []);
		if (fromApps.length > 0) {
			return fromApps.map((name) =>
				name.includes("__") ? name : `${serverKey}__${name}`,
			);
		}
	}

	return null;
};

/**
 * Server config for a single connection, as the UI needs it for discovery.
 * Returns null when the credential can't be read (locked passkey, missing secret)
 * — the same degradation the run path takes.
 */
export async function buildServerConfig(
	connection: McpConnection,
	secretOverride?: string,
): Promise<MCPServerConfig | null> {
	const auth = await applyAuth(connection, secretOverride);
	if (!auth) {
		return null;
	}
	return {
		type: connection.transport,
		name: toServerKey(connection),
		url: auth.url,
		headers: auth.headers,
	};
}

export interface ResolvedConnections {
	servers: MCPServerConfig[];
	/** Server-prefixed names. Empty means "no filtering". */
	toolAllowlist: string[];
	/** Connections that were referenced but could not be resolved. */
	skipped: string[];
}

export async function resolveConnections(
	selections: AgentConnectionSelection[],
): Promise<ResolvedConnections> {
	if (selections.length === 0) {
		return { servers: [], toolAllowlist: [], skipped: [] };
	}

	const registry = await listConnections();
	const byId = new Map(
		registry.map((connection) => [connection.id, connection]),
	);
	const selected = selections
		.map((selection) => ({
			selection,
			connection: byId.get(selection.connectionId),
		}))
		.filter(
			(
				entry,
			): entry is {
				selection: AgentConnectionSelection;
				connection: McpConnection;
			} => Boolean(entry.connection) && !entry.connection?.disabled,
		);

	const keys = assignUniqueKeys(selected.map((entry) => entry.connection));
	const servers: MCPServerConfig[] = [];
	const toolAllowlist: string[] = [];
	const skipped: string[] = [];

	for (const { selection, connection } of selected) {
		const serverKey = keys.get(connection.id) ?? connection.id;
		const auth = await applyAuth(connection);

		if (!auth) {
			skipped.push(connection.id);
			continue;
		}

		servers.push({
			type: connection.transport,
			name: serverKey,
			url: auth.url,
			headers: auth.headers,
		});

		const allowlist = resolveAllowlist(connection, selection, serverKey);
		if (allowlist) {
			toolAllowlist.push(...allowlist);
		}
	}

	return { servers, toolAllowlist, skipped };
}

/**
 * Flow-config transform applied just before a run, alongside the other
 * `applyX(config)` helpers in the chat handler.
 */
export async function withResolvedConnections(
	config: UnifiedFlowConfig,
): Promise<UnifiedFlowConfig> {
	try {
		const selections = readSelections(config);
		if (selections.length === 0) {
			return config;
		}

		const { servers, toolAllowlist, skipped } =
			await resolveConnections(selections);

		if (skipped.length > 0) {
			logWarn(
				`[MCP_CONNECTIONS] ${skipped.length} connection(s) skipped this run.`,
				skipped.join(", "),
			);
		}

		return {
			...config,
			steps: config.steps.map((step) =>
				step.name === MCP_FEATURE_NAME
					? {
							...step,
							// No reachable server means no tools; leaving the step enabled
							// would only add an empty MCP preamble to the prompt.
							enabled: step.enabled && servers.length > 0,
							config: {
								...(step.config ?? {}),
								servers,
								toolAllowlist,
							},
						}
					: step,
			),
		};
	} catch (error) {
		logWarn(
			"[MCP_CONNECTIONS] Resolution failed; running without MCP.",
			`${error}`,
		);
		return config;
	}
}
