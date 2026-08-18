/**
 * Tool discovery for the Connections UI.
 *
 * Deliberately runs through the same client the agent runtime uses
 * (`McpClientManager`) rather than a second implementation. That guarantees the
 * names shown in the scope list — prefixing included — are exactly the names the
 * model will see, and it carries MCP annotations through so read-only and
 * destructive tools can be labelled without guessing.
 */

import { McpClientManager } from "@memorall/agent-harness-mcp";
import { PERMISSIVE_MCP_OUTPUT_VALIDATION } from "@/services/flows-core/steps/features/mcp-feature/mcp-tool-adapter";
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

	const manager = new McpClientManager(
		[
			{
				id: server.name,
				transport: server.type,
				url: server.url,
				...(server.headers ? { headers: server.headers } : {}),
			},
		],
		{
			name: "memorall",
			prefixToolNames: true,
			jsonSchemaValidator: PERMISSIVE_MCP_OUTPUT_VALIDATION,
		},
	);

	const startedAt = Date.now();

	try {
		const tools = await manager.discover();
		const latencyMs = Date.now() - startedAt;

		const descriptors: CachedToolDescriptor[] = tools.map((tool) => {
			const annotations = tool.annotations as
				| Record<string, unknown>
				| undefined;
			return {
				name: tool.name,
				exposedName: tool.exposedName,
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
		await manager.close().catch(() => {
			// Closing a connection that never opened is not worth surfacing.
		});
	}
}
