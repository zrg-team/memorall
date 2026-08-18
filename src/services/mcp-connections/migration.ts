/**
 * One-way migration from per-agent embedded MCP servers to the shared registry.
 *
 * Runs when an agent's config is loaded. Idempotent: once a flow carries
 * `connections`, its `servers` array is no longer the source of truth and this
 * is a no-op.
 *
 * Existing `headers` are carried across as non-secret headers rather than being
 * promoted to encrypted secrets. Migration can run while the passkey is locked,
 * and a token that is already sitting in plain flow-config JSON is no worse off
 * in the registry — re-saving the connection with a typed auth mode is what
 * upgrades it.
 */

import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	MCP_FEATURE_NAME,
	type MCPServerConfig,
} from "@memorall/agent-harness-flows/steps/features/mcp-feature/index";
import { logInfo } from "@/utils/logger";
import { listConnections, upsertConnection } from "./registry";
import type { AgentConnectionSelection, McpConnection } from "./types";

const newId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `conn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const isLegacyServer = (value: unknown): value is MCPServerConfig =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as MCPServerConfig).url === "string";

/**
 * Reuse an existing registry entry when one already points at the same URL, so
 * three agents sharing a server converge on one connection instead of three.
 */
const findEquivalent = (
	connections: McpConnection[],
	server: MCPServerConfig,
): McpConnection | undefined =>
	connections.find(
		(connection) =>
			connection.url === server.url && connection.transport === server.type,
	);

/**
 * Turn raw server configs into registry entries and the selections that point at
 * them, reusing an existing entry whenever one already targets the same URL.
 *
 * Shared by the legacy migration and by the agent wizard, which authors servers
 * directly and still needs them to land in the registry rather than beside it.
 */
export async function ensureConnectionsForServers(
	servers: MCPServerConfig[],
): Promise<AgentConnectionSelection[]> {
	const existing = await listConnections();
	const selections: AgentConnectionSelection[] = [];
	const timestamp = new Date().toISOString();

	for (const server of servers) {
		const match = findEquivalent(existing, server);
		if (match) {
			selections.push({ connectionId: match.id });
			continue;
		}

		const connection: McpConnection = {
			id: newId(),
			kind: "custom",
			name: server.name?.trim() || "Imported server",
			transport: server.type === "sse" ? "sse" : "http",
			url: server.url,
			authMode: "none",
			headers: server.headers ?? {},
			enabledByDefault: false,
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		await upsertConnection(connection);
		existing.push(connection);
		selections.push({ connectionId: connection.id });
	}

	return selections;
}

export interface LegacyMigrationResult {
	config: UnifiedFlowConfig;
	migrated: boolean;
}

export async function migrateLegacyServers(
	config: UnifiedFlowConfig,
): Promise<LegacyMigrationResult> {
	const step = config.steps.find(
		(candidate) => candidate.name === MCP_FEATURE_NAME,
	);
	if (!step) {
		return { config, migrated: false };
	}

	const alreadyMigrated = Array.isArray(step.config?.connections);
	const servers = Array.isArray(step.config?.servers)
		? step.config.servers.filter(isLegacyServer)
		: [];

	if (alreadyMigrated || servers.length === 0) {
		return { config, migrated: false };
	}

	const selections = await ensureConnectionsForServers(servers);

	logInfo(
		`[MCP_CONNECTIONS] Migrated ${servers.length} embedded MCP server(s) to the registry.`,
	);

	return {
		migrated: true,
		config: {
			...config,
			steps: config.steps.map((candidate) =>
				candidate.name === MCP_FEATURE_NAME
					? {
							...candidate,
							config: { ...(candidate.config ?? {}), connections: selections },
						}
					: candidate,
			),
		},
	};
}
