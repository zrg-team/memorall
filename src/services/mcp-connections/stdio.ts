/**
 * Local MCP servers: connection records -> the spec the desktop starts.
 *
 * A local server runs as the user with whatever the command can reach, so it
 * never starts without the user having seen the exact command on this device.
 * That approval is kept per device in the platform store, not in the registry:
 * the registry is exported and imported with the rest of the user's data, and
 * an imported archive must not be able to start a process on its own.
 */

import type { MCPStdioServerConfig } from "@memorall/agent-harness-flows/steps/features/mcp-feature/types";
import type { McpStdioSpec } from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import { logWarn } from "@/utils/logger";
import { loadSecret } from "@/utils/master-key";
import type { McpConnection, StdioConnectionDetail } from "./types";

export const STDIO_APPROVALS_KEY = "mcp.stdio.approvals.v1";

type StdioConnection = McpConnection & { stdio: StdioConnectionDetail };

export const isStdioConnection = (
	connection: McpConnection,
): connection is StdioConnection =>
	connection.transport === "stdio" && Boolean(connection.stdio);

/** Whether this app can start local servers at all. */
export const canRunLocalServers = (): boolean => Boolean(platform.mcpStdio);

/** `npx -y pkg /path`, for showing the user exactly what will run. */
export const formatCommandLine = (detail: StdioConnectionDetail): string =>
	[detail.command, ...detail.args]
		.map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part))
		.join(" ");

/**
 * Secret env values for a connection, `{}` when it has none, or null when they
 * cannot be read (locked passkey, missing record).
 */
export async function loadStdioSecrets(
	connection: StdioConnection,
): Promise<Record<string, string> | null> {
	const keys = connection.stdio.secretEnvKeys ?? [];
	if (keys.length === 0) return {};
	if (!connection.secretRef) return null;
	try {
		const stored = await loadSecret(connection.secretRef);
		if (!stored) return null;
		const parsed = JSON.parse(stored) as Record<string, unknown>;
		const values: Record<string, string> = {};
		for (const key of keys) {
			const value = parsed[key];
			if (typeof value !== "string") return null;
			values[key] = value;
		}
		return values;
	} catch (error) {
		logWarn(
			`[MCP_CONNECTIONS] Secrets unavailable for local server "${connection.name}".`,
			`${error}`,
		);
		return null;
	}
}

/**
 * The spec for a connection. `secretValues` lets a setup form start a server
 * before anything is saved; otherwise secrets are read from the encrypted store.
 */
export async function buildStdioSpec(
	connection: StdioConnection,
	secretValues?: Record<string, string>,
): Promise<McpStdioSpec | null> {
	const secrets = secretValues ?? (await loadStdioSecrets(connection));
	if (!secrets) return null;
	const { stdio } = connection;
	return {
		id: connection.id,
		command: stdio.command,
		args: [...stdio.args],
		...(stdio.cwd ? { cwd: stdio.cwd } : {}),
		env: { ...(stdio.env ?? {}), ...secrets },
		secretEnvKeys: [...(stdio.secretEnvKeys ?? [])],
	};
}

export async function buildStdioServerConfig(
	connection: StdioConnection,
	name: string,
): Promise<MCPStdioServerConfig | null> {
	const spec = await buildStdioSpec(connection);
	if (!spec) return null;
	return {
		type: "stdio",
		name,
		id: spec.id,
		command: spec.command,
		args: spec.args,
		...(spec.cwd ? { cwd: spec.cwd } : {}),
		env: spec.env,
		secretEnvKeys: spec.secretEnvKeys,
	};
}

/**
 * What the user approved: everything that decides what runs. Secret values are
 * left out on purpose — rotating a token does not change the program — but
 * which variables are secret is part of it.
 */
export async function stdioApprovalFingerprint(
	detail: StdioConnectionDetail,
): Promise<string> {
	const canonical = JSON.stringify([
		detail.command,
		detail.args,
		detail.cwd ?? null,
		Object.entries(detail.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
		[...(detail.secretEnvKeys ?? [])].sort(),
	]);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

const readApprovals = async (): Promise<Record<string, string>> => {
	try {
		return (
			(await platform.persistentStore.get<Record<string, string>>(
				STDIO_APPROVALS_KEY,
			)) ?? {}
		);
	} catch {
		return {};
	}
};

export async function isStdioApproved(
	connection: StdioConnection,
): Promise<boolean> {
	const approvals = await readApprovals();
	const approved = approvals[connection.id];
	return (
		Boolean(approved) &&
		approved === (await stdioApprovalFingerprint(connection.stdio))
	);
}

export async function approveStdio(connection: StdioConnection): Promise<void> {
	const approvals = await readApprovals();
	await platform.persistentStore.set(STDIO_APPROVALS_KEY, {
		...approvals,
		[connection.id]: await stdioApprovalFingerprint(connection.stdio),
	});
}

export async function revokeStdioApproval(connectionId: string): Promise<void> {
	const approvals = await readApprovals();
	if (!(connectionId in approvals)) return;
	const { [connectionId]: _removed, ...rest } = approvals;
	await platform.persistentStore.set(STDIO_APPROVALS_KEY, rest);
}
