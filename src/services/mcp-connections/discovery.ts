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
import { PERMISSIVE_MCP_OUTPUT_VALIDATION } from "@memorall/agent-harness-flows/steps/features/mcp-feature/mcp-tool-adapter";
import { McpStdioPortError } from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import { buildServerConfig, toServerKey } from "./resolve";
import { buildStdioSpec, isStdioApproved, isStdioConnection } from "./stdio";
import type { CachedToolDescriptor, McpConnection } from "./types";

export type DiscoveryFailureReason =
	| "locked"
	| "unreachable"
	/** Local servers need the desktop app. */
	| "unsupported"
	/** The command changed, or was never approved on this device. */
	| "not-approved"
	/** `npx`, `uvx` or the command itself is not installed. */
	| "runtime-missing"
	/** The process started but exited or never finished its handshake. */
	| "exited";

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

const STDIO_FAILURE_REASONS: Record<string, DiscoveryFailureReason> = {
	MCP_STDIO_COMMAND_NOT_FOUND: "runtime-missing",
	MCP_STDIO_EXITED: "exited",
	MCP_STDIO_START_TIMEOUT: "exited",
	MCP_STDIO_CRASH_LOOP: "exited",
	MCP_STDIO_INVALID_CWD: "exited",
	MCP_STDIO_UNSUPPORTED: "unsupported",
};

/**
 * Start a local server (if it is not running) and list its tools.
 *
 * `secretValues` lets the setup wizard try a server before it is saved. The
 * command must already be approved on this device either way.
 */
export async function discoverStdioConnection(
	connection: McpConnection,
	secretValues?: Record<string, string>,
): Promise<DiscoveryResult> {
	const port = platform.mcpStdio;
	if (!port || !isStdioConnection(connection)) {
		return {
			ok: false,
			reason: "unsupported",
			error: "Local servers run in the Memorall desktop app.",
		};
	}
	if (!(await isStdioApproved(connection))) {
		return {
			ok: false,
			reason: "not-approved",
			error: "Approve this command before it runs.",
		};
	}
	const spec = await buildStdioSpec(connection, secretValues);
	if (!spec) {
		return {
			ok: false,
			reason: "locked",
			error: "Credentials are unavailable — unlock with your passkey.",
		};
	}

	const startedAt = Date.now();
	try {
		await port.ensure(spec);
		const tools = await port.listTools(spec);
		const prefix = toServerKey(connection);
		return {
			ok: true,
			latencyMs: Date.now() - startedAt,
			descriptors: tools.map((tool) => ({
				name: tool.name,
				exposedName: `${prefix}__${tool.name}`,
				description: tool.description ?? "",
				readOnly: readBoolean(tool.annotations, "readOnlyHint"),
				destructive: readBoolean(tool.annotations, "destructiveHint"),
			})),
		};
	} catch (error) {
		return {
			ok: false,
			reason:
				(error instanceof McpStdioPortError &&
					STDIO_FAILURE_REASONS[error.code]) ||
				"unreachable",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function discoverConnection(
	connection: McpConnection,
	secretOverride?: string,
): Promise<DiscoveryResult> {
	if (connection.transport === "stdio") {
		return discoverStdioConnection(connection);
	}
	const server = await buildServerConfig(connection, secretOverride);

	if (!server || server.type === "stdio") {
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
