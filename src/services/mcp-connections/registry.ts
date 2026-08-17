/**
 * Persistence for the Connections registry.
 *
 * Config lives in the generic `configurations` table (keyed JSONB) rather than a
 * dedicated table — the shape is small, read whole, and needs no migration.
 * Credentials never land here; they go to `encryptions` via the keyed-secret
 * helpers in `@/utils/master-key`, and the registry only stores the key name.
 *
 * Live status (connected / bridge-down / error) is deliberately *not* persisted.
 * It is derived in memory by the UI store so health polling causes no DB churn.
 */

import { eq } from "drizzle-orm";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import {
	CONNECTIONS_CONFIG_KEY,
	EMPTY_REGISTRY,
	EMPTY_TOOL_CACHE,
	TOOL_CACHE_CONFIG_KEY,
	type ConnectionRegistry,
	type McpConnection,
	type ToolCache,
	type ToolCacheEntry,
} from "./types";

async function readConfig<T>(key: string, fallback: T): Promise<T> {
	try {
		const rows = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.configurations)
				.where(eq(schema.configurations.key, key)),
		);

		const data = rows[0]?.data;
		if (!data || typeof data !== "object") {
			return fallback;
		}
		return data as T;
	} catch (error) {
		logError(`[MCP_CONNECTIONS] Failed to read ${key}:`, error);
		return fallback;
	}
}

async function writeConfig<T>(key: string, value: T): Promise<void> {
	const now = new Date();
	const data = value as Record<string, unknown>;

	const existing = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({ id: schema.configurations.id })
			.from(schema.configurations)
			.where(eq(schema.configurations.key, key)),
	);

	if (existing.length > 0) {
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.update(schema.configurations)
				.set({ data, updatedAt: now })
				.where(eq(schema.configurations.key, key)),
		);
		return;
	}

	await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.insert(schema.configurations)
			.values({ key, data, createdAt: now, updatedAt: now }),
	);
}

export async function loadConnectionRegistry(): Promise<ConnectionRegistry> {
	const registry = await readConfig<ConnectionRegistry>(
		CONNECTIONS_CONFIG_KEY,
		EMPTY_REGISTRY,
	);
	return Array.isArray(registry.connections) ? registry : EMPTY_REGISTRY;
}

export async function saveConnectionRegistry(
	registry: ConnectionRegistry,
): Promise<void> {
	await writeConfig(CONNECTIONS_CONFIG_KEY, registry);
}

export async function listConnections(): Promise<McpConnection[]> {
	return (await loadConnectionRegistry()).connections;
}

export async function getConnection(id: string): Promise<McpConnection | null> {
	const connections = await listConnections();
	return connections.find((connection) => connection.id === id) ?? null;
}

/** Insert or replace by id, stamping `updatedAt`. */
export async function upsertConnection(
	connection: McpConnection,
): Promise<void> {
	const registry = await loadConnectionRegistry();
	const next = { ...connection, updatedAt: new Date().toISOString() };
	const index = registry.connections.findIndex(
		(candidate) => candidate.id === connection.id,
	);

	const connections =
		index >= 0
			? registry.connections.map((candidate, candidateIndex) =>
					candidateIndex === index ? next : candidate,
				)
			: [...registry.connections, next];

	await saveConnectionRegistry({ ...registry, connections });
}

export async function removeConnection(id: string): Promise<void> {
	const registry = await loadConnectionRegistry();
	await saveConnectionRegistry({
		...registry,
		connections: registry.connections.filter(
			(connection) => connection.id !== id,
		),
	});
	await removeToolCacheEntry(id);
}

export async function loadToolCache(): Promise<ToolCache> {
	const cache = await readConfig<ToolCache>(
		TOOL_CACHE_CONFIG_KEY,
		EMPTY_TOOL_CACHE,
	);
	return cache.entries && typeof cache.entries === "object"
		? cache
		: EMPTY_TOOL_CACHE;
}

export async function saveToolCacheEntry(
	connectionId: string,
	entry: ToolCacheEntry,
): Promise<void> {
	const cache = await loadToolCache();
	await writeConfig(TOOL_CACHE_CONFIG_KEY, {
		...cache,
		entries: { ...cache.entries, [connectionId]: entry },
	} satisfies ToolCache);
}

export async function removeToolCacheEntry(
	connectionId: string,
): Promise<void> {
	const cache = await loadToolCache();
	if (!(connectionId in cache.entries)) {
		return;
	}
	const entries = { ...cache.entries };
	delete entries[connectionId];
	await writeConfig(TOOL_CACHE_CONFIG_KEY, {
		...cache,
		entries,
	} satisfies ToolCache);
}
