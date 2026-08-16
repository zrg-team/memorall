import { create } from "zustand";
import {
	discoverConnection,
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
	| "unknown";

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

/**
 * A failing local server and a failing SaaS endpoint need completely different
 * fixes — "run the bridge command" versus "check the token" — so they are
 * distinct states rather than one generic error.
 */
export const deriveStatus = (
	connection: McpConnection,
	entry: ToolCacheEntry | undefined,
	unlocked: boolean,
): ConnectionStatus => {
	if (connection.disabled) return "off";
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
	error: string | null;

	initialize: () => Promise<void>;
	refresh: () => Promise<void>;
	select: (id: string | null) => void;
	save: (connection: McpConnection) => Promise<void>;
	remove: (id: string) => Promise<void>;
	discover: (id: string) => Promise<void>;
	discoverAll: () => Promise<void>;
	unlock: (passkey: string) => Promise<void>;

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
	},

	select: (selectedId) => set({ selectedId }),

	save: async (connection) => {
		await upsertConnection(connection);
		await get().refresh();
		set({ selectedId: connection.id });
	},

	remove: async (id) => {
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
		if (!connection?.url || get().discovering.includes(id)) return;

		set({ discovering: [...get().discovering, id] });
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
		}
	},

	discoverAll: async () => {
		const ids = get()
			.connections.filter((connection) => !connection.disabled)
			.map((connection) => connection.id);
		await Promise.all(ids.map((id) => get().discover(id)));
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
		return deriveStatus(connection, get().toolCache[id], get().unlocked);
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
