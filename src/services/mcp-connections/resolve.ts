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

import type { UnifiedFlowConfig } from "@/services/flows-core/interfaces/config/flow-config";
import {
	MCP_FEATURE_NAME,
	type MCPServerConfig,
} from "@/services/flows-core/steps/features/mcp-feature";
import { logWarn } from "@/utils/logger";
import { loadSecret } from "@/utils/master-key";
import { listConnections, upsertConnection } from "./registry";
import {
	type AgentConnectionSelection,
	COMPOSIO_SECRET_KEY,
	COMPOSIO_USER_ID,
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

	// Composio is deliberately absent here. Its router exposes six fixed tools
	// (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, …) whose names are the
	// same whichever app they reach, so a name filter cannot express "GitHub
	// only" — and filtering on app-level slugs would drop every router tool and
	// leave the agent with nothing. App scope is enforced by minting a session
	// for exactly those toolkits; see resolveScopedComposioUrl.
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

/**
 * The endpoint for a tool-router session carrying exactly `appIds`.
 *
 * Composio's router can reach whatever toolkits its SESSION was minted with, so
 * this is the only place agent scope can be enforced — an allowlist cannot do
 * it. Returning null means "this scope could not be honoured", and the caller
 * drops the connection rather than falling back to the full session: quietly
 * widening an agent from GitHub to every authorized app is the exact failure
 * this exists to prevent.
 *
 * Sessions are cached per sorted app-set on the connection, so a given scope is
 * minted once rather than on every run.
 */
async function mintScopedComposioUrl(
	connection: McpConnection,
	appIds: string[],
): Promise<string | null> {
	// An app the user has since disconnected is no longer grantable, however old
	// the agent's selection is.
	const authorized = new Set((connection.apps ?? []).map((app) => app.id));
	const toolkits = [...new Set(appIds)]
		.filter((id) => authorized.size === 0 || authorized.has(id))
		.sort();
	if (toolkits.length === 0) {
		return null;
	}

	// Selecting every authorized app is the unscoped session already on record.
	const all = [...new Set(connection.composio?.toolkits ?? [])].sort();
	if (all.length > 0 && toolkits.join(",") === all.join(",")) {
		return connection.url;
	}

	const cacheKey = toolkits.join(",");
	const cached = connection.composio?.scopedSessions?.[cacheKey];
	if (cached) return cached;

	const apiKey = await loadComposioApiKey();
	if (!apiKey) return null;

	const { ComposioClient } = await import("@/services/composio");
	const session = await new ComposioClient(apiKey).createMcpSession({
		userId: COMPOSIO_USER_ID,
		toolkits,
	});

	await upsertConnection({
		...connection,
		composio: {
			...(connection.composio ?? { toolkits: [] }),
			scopedSessions: {
				...(connection.composio?.scopedSessions ?? {}),
				[cacheKey]: session.url,
			},
		},
	});

	return session.url;
}

/** Run-path wrapper: a scope that cannot be minted contributes nothing. */
async function resolveScopedComposioUrl(
	connection: McpConnection,
	appIds: string[],
): Promise<string | null> {
	try {
		return await mintScopedComposioUrl(connection, appIds);
	} catch (error) {
		logWarn(
			`[MCP_CONNECTIONS] Could not mint a Composio session for "${connection.name}"; dropping it for this run.`,
			`${error}`,
		);
		return null;
	}
}

/**
 * Why a granted provider would contribute nothing, in the user's words.
 *
 * Minting happens lazily on the run path, where there is no UI to fail into —
 * so the picker calls this when the user saves and surfaces what it finds.
 * Silence here is what made "I granted GitHub and the agent has no tools" so
 * hard to explain.
 */
export interface ScopeProblem {
	connectionId: string;
	connectionName: string;
	message: string;
}

export async function prepareConnectionScopes(
	selections: AgentConnectionSelection[],
): Promise<ScopeProblem[]> {
	const problems: ScopeProblem[] = [];
	let registry: McpConnection[];
	try {
		registry = await listConnections();
	} catch {
		return problems;
	}
	const byId = new Map(registry.map((entry) => [entry.id, entry]));

	for (const selection of selections) {
		const connection = byId.get(selection.connectionId);
		if (!connection || connection.kind !== "composio") continue;

		try {
			const url = await mintScopedComposioUrl(
				connection,
				selection.appIds ?? [],
			);
			if (!url) {
				problems.push({
					connectionId: connection.id,
					connectionName: connection.name,
					message: "No app is granted, or its Composio key is unavailable.",
				});
			}
		} catch (error) {
			// The common cause is a scoped project key: minting a per-agent session
			// needs "sessions" write access, and a read-only key answers 403.
			const { describeComposioError } = await import("@/services/composio");
			problems.push({
				connectionId: connection.id,
				connectionName: connection.name,
				message: describeComposioError(error),
			});
		}
	}

	return problems;
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

		// Composio's router reaches whatever toolkits its SESSION carries, so an
		// agent that may only use GitHub needs its own session. A selection with
		// no apps grants nothing — attaching the credential is not consent to
		// every app on it, and a newly authorized app must never widen an agent
		// that already exists.
		let url = auth.url;
		if (connection.kind === "composio") {
			const scoped = await resolveScopedComposioUrl(
				connection,
				selection.appIds ?? [],
			);
			if (!scoped) {
				skipped.push(connection.id);
				continue;
			}
			url = scoped;
		}

		servers.push({
			type: connection.transport,
			name: serverKey,
			url,
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
							// Selecting connections IS the intent to use them. Requiring the
							// feature toggle as well meant an agent could show its
							// connections attached and still get no tools at run time.
							enabled: servers.length > 0,
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
