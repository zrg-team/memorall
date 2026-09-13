import { create } from "zustand";
import type { McpStdioServerStatus } from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import {
	approveStdio as approveStdioConnection,
	buildStdioSpec,
	discoverConnection,
	isStdioApproved,
	isStdioConnection,
	revokeStdioApproval,
	listConnections,
	loadToolCache,
	removeConnection,
	saveToolCacheEntry,
	upsertConnection,
	type CachedToolDescriptor,
	type McpConnection,
	type ToolCacheEntry,
} from "@/services/mcp-connections";
import { isMasterKeyUnlocked, unlockMasterKey } from "@/utils/master-key";
import { logError } from "@/utils/logger";

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

/** Shared empty result so selectors keep a stable identity between renders. */
const NO_TOOLS: CachedToolDescriptor[] = [];

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

interface ConnectionsState {
	connections: McpConnection[];
	toolCache: Record<string, ToolCacheEntry>;
	selectedId: string | null;
	unlocked: boolean;
	isLoading: boolean;
	/** Connection ids with discovery in flight. */
	discovering: string[];
	/** Local servers by connection id. */
	localServers: Record<string, LocalServerRuntime>;
	error: string | null;

	initialize: () => Promise<void>;
	refresh: () => Promise<void>;
	select: (id: string | null) => void;
	save: (connection: McpConnection) => Promise<void>;
	remove: (id: string) => Promise<void>;
	discover: (id: string) => Promise<void>;
	discoverAll: () => Promise<void>;
	unlock: (passkey: string) => Promise<void>;
	/** Re-read approvals and process state for every local server. */
	refreshLocalServers: () => Promise<void>;
	approveLocalServer: (id: string) => Promise<void>;
	stopLocalServer: (id: string) => Promise<void>;
	/** Stop, then start fresh; also clears a crash-loop hold. */
	restartLocalServer: (id: string) => Promise<void>;

	statusOf: (id: string) => ConnectionStatus;
	toolsOf: (id: string) => CachedToolDescriptor[];
	totalToolCount: () => number;
	connectedCount: () => number;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
	connections: [],
	toolCache: {},
	selectedId: null,
	unlocked: false,
	isLoading: false,
	discovering: [],
	localServers: {},
	error: null,

	initialize: async () => {
		if (get().isLoading) return;
		set({ isLoading: true, error: null });
		try {
			const [connections, cache, unlocked] = await Promise.all([
				listConnections(),
				loadToolCache(),
				isMasterKeyUnlocked(),
			]);
			set({
				connections,
				toolCache: cache.entries,
				unlocked,
				isLoading: false,
				selectedId: get().selectedId ?? connections[0]?.id ?? null,
			});
			await get().refreshLocalServers();
		} catch (error) {
			logError("[ConnectionsStore] Failed to initialize:", error);
			set({
				isLoading: false,
				error: error instanceof Error ? error.message : "Failed to load",
			});
		}
	},

	refresh: async () => {
		const [connections, cache, unlocked] = await Promise.all([
			listConnections(),
			loadToolCache(),
			isMasterKeyUnlocked(),
		]);
		set({ connections, toolCache: cache.entries, unlocked });
		await get().refreshLocalServers();
	},

	select: (selectedId) => set({ selectedId }),

	save: async (connection) => {
		await upsertConnection(connection);
		await get().refresh();
		set({ selectedId: connection.id });
	},

	remove: async (id) => {
		const connection = get().connections.find(
			(candidate) => candidate.id === id,
		);
		if (connection?.transport === "stdio") {
			// A deleted local server must not keep running, or start again later
			// under a recycled approval.
			await platform.mcpStdio?.stop(id).catch(() => null);
			await revokeStdioApproval(id);
		}
		await removeConnection(id);
		const remaining = get().connections.filter(
			(connection) => connection.id !== id,
		);
		set({
			selectedId:
				get().selectedId === id ? (remaining[0]?.id ?? null) : get().selectedId,
		});
		await get().refresh();
	},

	discover: async (id) => {
		const connection = get().connections.find(
			(candidate) => candidate.id === id,
		);
		// Nothing to discover before setup produces an endpoint.
		const isLocal = connection?.transport === "stdio";
		if (!connection || (!connection.url && !isLocal)) return;
		if (get().discovering.includes(id)) return;

		set({ discovering: [...get().discovering, id] });
		const current = get().localServers[id];
		if (isLocal && current?.approved) {
			// Starting can take a while (a first npx run downloads the package);
			// show it as starting rather than as whatever it was before.
			set({
				localServers: {
					...get().localServers,
					[id]: {
						...current,
						status: {
							id,
							pid: null,
							startedAt: null,
							lastError: null,
							fingerprint: "",
							logTail: current.status?.logTail ?? [],
							state: "starting",
						},
					},
				},
			});
		}
		try {
			const result = await discoverConnection(connection);
			const entry: ToolCacheEntry = result.ok
				? {
						descriptors: result.descriptors,
						discoveredAt: new Date().toISOString(),
					}
				: {
						descriptors: get().toolCache[id]?.descriptors ?? [],
						discoveredAt:
							get().toolCache[id]?.discoveredAt ?? new Date().toISOString(),
						error: result.error,
					};

			await saveToolCacheEntry(id, entry);
			set({ toolCache: { ...get().toolCache, [id]: entry } });
		} catch (error) {
			logError(`[ConnectionsStore] Discovery failed for ${id}:`, error);
		} finally {
			set({
				discovering: get().discovering.filter((candidate) => candidate !== id),
			});
			if (isLocal) await get().refreshLocalServers();
		}
	},

	discoverAll: async () => {
		// Local servers are left alone: opening a page must never start processes.
		// They report their state instead, and start on an explicit action or a run.
		const ids = get()
			.connections.filter(
				(connection) =>
					!connection.disabled && connection.transport !== "stdio",
			)
			.map((connection) => connection.id);
		await Promise.all([
			...ids.map((id) => get().discover(id)),
			get().refreshLocalServers(),
		]);
	},

	refreshLocalServers: async () => {
		const local = get().connections.filter(isStdioConnection);
		if (local.length === 0) {
			if (Object.keys(get().localServers).length > 0) {
				set({ localServers: {} });
			}
			return;
		}
		const ids = local.map((connection) => connection.id);
		const [approvals, statuses] = await Promise.all([
			Promise.all(local.map((connection) => isStdioApproved(connection))),
			platform.mcpStdio
				? platform.mcpStdio.status(ids).catch((error: unknown) => {
						logError("[ConnectionsStore] Local server status failed:", error);
						return [] as McpStdioServerStatus[];
					})
				: Promise.resolve([] as McpStdioServerStatus[]),
		]);
		const byId = new Map(statuses.map((status) => [status.id, status]));
		const localServers: Record<string, LocalServerRuntime> = {};
		local.forEach((connection, index) => {
			const status = byId.get(connection.id);
			localServers[connection.id] = {
				approved: approvals[index] ?? false,
				...(status ? { status } : {}),
			};
		});
		set({ localServers });
	},

	approveLocalServer: async (id) => {
		const connection = get().connections.find(
			(candidate) => candidate.id === id,
		);
		if (!connection || !isStdioConnection(connection)) return;
		await approveStdioConnection(connection);
		await get().refreshLocalServers();
	},

	stopLocalServer: async (id) => {
		try {
			await platform.mcpStdio?.stop(id);
		} catch (error) {
			logError(`[ConnectionsStore] Failed to stop ${id}:`, error);
		}
		await get().refreshLocalServers();
	},

	restartLocalServer: async (id) => {
		const connection = get().connections.find(
			(candidate) => candidate.id === id,
		);
		const port = platform.mcpStdio;
		if (!connection || !isStdioConnection(connection) || !port) return;
		try {
			await port.stop(id);
			const spec = await buildStdioSpec(connection);
			if (spec) await port.ensure(spec, { force: true });
		} catch (error) {
			logError(`[ConnectionsStore] Failed to restart ${id}:`, error);
		}
		await get().discover(id);
	},

	unlock: async (passkey) => {
		await unlockMasterKey(passkey);
		set({ unlocked: true });
		await get().discoverAll();
	},

	statusOf: (id) => {
		const connection = get().connections.find(
			(candidate) => candidate.id === id,
		);
		if (!connection) return "unknown";
		return deriveStatus(
			connection,
			get().toolCache[id],
			get().unlocked,
			get().localServers[id],
		);
	},

	// Must return a stable reference. Components call this inside a selector, and
	// a fresh `[]` on every call reads as a state change to useSyncExternalStore,
	// which re-renders, which allocates another `[]` — React error #185.
	toolsOf: (id) => get().toolCache[id]?.descriptors ?? NO_TOOLS,

	totalToolCount: () =>
		get().connections.reduce((total, connection) => {
			if (connection.disabled) return total;
			const descriptors = get().toolCache[connection.id]?.descriptors ?? [];
			const allowlist = connection.toolAllowlist;
			return (
				total +
				(allowlist?.length
					? descriptors.filter((tool) => allowlist.includes(tool.exposedName))
							.length
					: descriptors.length)
			);
		}, 0),

	connectedCount: () =>
		get().connections.filter(
			(connection) => get().statusOf(connection.id) === "connected",
		).length,
}));
