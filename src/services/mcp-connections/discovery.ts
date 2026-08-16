/**
 * Tool discovery for the Connections UI.
 *
 * Deliberately runs through the same client the agent runtime uses
 * (`MultiServerMCPClient` + `adaptMCPTool`) rather than a second implementation.
 * That guarantees the names shown in the scope list — prefixing included — are
 * exactly the names the model will see, and it carries MCP annotations through
 * so read-only and destructive tools can be labelled without guessing.
 */

import { MultiServerMCPClient } from "@/services/flows-legacy/utils/langchain-mcp-adapter/index";
import { adaptMCPTool } from "@/services/flows-legacy/steps/features/mcp-feature/mcp-tool-adapter";
import { buildServerConfig } from "./resolve";
import type { CachedToolDescriptor, McpConnection } from "./types";

export type DiscoveryFailureReason = "locked" | "unreachable";

export interface DiscoverySuccess {
	ok: true;
	descriptors: CachedToolDescriptor[];
	/** Round-trip time for the discovery call, for the "38 ms" readout. */
	latencyMs: number;
}

export interface DiscoveryFailure {
	ok: false;
	reason: DiscoveryFailureReason;
	error: string;
}

export type DiscoveryResult = DiscoverySuccess | DiscoveryFailure;

const readBoolean = (
	annotations: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined => {
	const value = annotations?.[key];
	return typeof value === "boolean" ? value : undefined;
};

export async function discoverConnection(
	connection: McpConnection,
	secretOverride?: string,
): Promise<DiscoveryResult> {
	const server = await buildServerConfig(connection, secretOverride);

	if (!server) {
		return {
			ok: false,
			reason: "locked",
			error: "Credentials are unavailable — unlock with your passkey.",
		};
	}

	const client = new MultiServerMCPClient({
		mcpServers: {
			[server.name]: {
				type: server.type,
				url: server.url,
				...(server.headers ? { headers: server.headers } : {}),
			},
		},
		throwOnLoadError: true,
		prefixToolNameWithServerName: true,
		onConnectionError: "throw",
	});

	const startedAt = Date.now();

	try {
		await client.initializeConnections();
		const tools = await client.getTools();
		const latencyMs = Date.now() - startedAt;

		const descriptors: CachedToolDescriptor[] = tools
			.map(adaptMCPTool)
			.map((tool) => {
				const annotations = tool.annotations as
					| Record<string, unknown>
					| undefined;
				return {
					name: tool.name.includes("__")
						? tool.name.slice(tool.name.indexOf("__") + 2)
						: tool.name,
					exposedName: tool.name,
					description: tool.description ?? "",
					readOnly: readBoolean(annotations, "readOnlyHint"),
					destructive: readBoolean(annotations, "destructiveHint"),
				} satisfies CachedToolDescriptor;
			});

		return { ok: true, descriptors, latencyMs };
	} catch (error) {
		return {
			ok: false,
			reason: "unreachable",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await client.close().catch(() => {
			// Closing a connection that never opened is not worth surfacing.
		});
	}
}
