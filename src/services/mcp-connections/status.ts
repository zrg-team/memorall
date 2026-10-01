import type { McpStdioServerStatus } from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import type { McpConnection, ToolCacheEntry } from "./types";

/**
 * Live status for a connection. Never persisted — recomputed from the tool
 * cache and the passkey state, so health polling causes no database writes.
 */
export type ConnectionStatus =
	| "connected"
	| "incomplete"
	| "locked"
	| "needs-auth"
	| "bridge-down"
	| "error"
	| "off"
	| "unknown"
	/** A local server whose process is being started. */
	| "starting"
	/** A local server that is set up but not running; the next run starts it. */
	| "stopped"
	/** A local server whose command was not approved on this device. */
	| "needs-approval"
	/** A local server whose launcher (npx, uvx, ...) is not installed. */
	| "runtime-missing";

/** What the desktop reports about a local server, plus whether it may run. */
export interface LocalServerRuntime {
	status?: McpStdioServerStatus;
	approved: boolean;
}

const isLocalUrl = (url: string): boolean => {
	try {
		const { hostname } = new URL(url);
		return (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "0.0.0.0" ||
			hostname.endsWith(".local")
		);
	} catch {
		return false;
	}
};

const RUNTIME_MISSING =
	/not installed or not on PATH|MCP_STDIO_COMMAND_NOT_FOUND/i;

const deriveLocalServerStatus = (
	connection: McpConnection,
	entry: ToolCacheEntry | undefined,
	unlocked: boolean,
	runtime: LocalServerRuntime | undefined,
): ConnectionStatus => {
	if (!platform.mcpStdio) return "off";
	if (runtime && !runtime.approved) return "needs-approval";
	if ((connection.stdio?.secretEnvKeys?.length ?? 0) > 0 && !unlocked) {
		return "locked";
	}
	const state = runtime?.status?.state;
	if (state === "starting") return "starting";
	if (state === "running") return "connected";
	const failure =
		(state === "error" || state === "exited"
			? runtime?.status?.lastError
			: null) ?? entry?.error;
	if (failure) {
		return RUNTIME_MISSING.test(failure) ? "runtime-missing" : "error";
	}
	return entry ? "stopped" : "unknown";
};

/**
 * A failing local server and a failing SaaS endpoint need completely different
 * fixes — "run the bridge command" versus "check the token" — so they are
 * distinct states rather than one generic error.
 */
export const deriveStatus = (
	connection: McpConnection,
	entry: ToolCacheEntry | undefined,
	unlocked: boolean,
	runtime?: LocalServerRuntime,
): ConnectionStatus => {
	if (connection.disabled) return "off";
	// A local server has no URL; its health is its process.
	if (connection.transport === "stdio") {
		return deriveLocalServerStatus(connection, entry, unlocked, runtime);
	}
	// Saved but not finished — a Composio key with no apps yet, or any record
	// without an endpoint. Making this a real state is what stops half-finished
	// setup from vanishing and leaving the page looking empty.
	if (!connection.url) return "incomplete";
	if (connection.authMode !== "none" && !unlocked) return "locked";
	if (!entry) return "unknown";
	if (!entry.error) return "connected";
	if (isLocalUrl(connection.url)) return "bridge-down";
	if (/401|403|unauthor|forbidden/i.test(entry.error)) return "needs-auth";
	return "error";
};
