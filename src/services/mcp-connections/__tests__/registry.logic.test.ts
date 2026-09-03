import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The registry lives in the generic `configurations` table; this fake keeps
 * just enough of the drizzle chain the registry uses to read and write one
 * keyed JSON row at a time.
 */
const rows = new Map<string, Record<string, unknown>>();
const deleteSecret = vi.fn(async (_key: string) => undefined);

const fakeDb = {
	select: () => ({
		from: () => ({
			where: async (condition: { value: string }) =>
				rows.has(condition.value)
					? [{ id: 1, data: rows.get(condition.value) }]
					: [],
		}),
	}),
	update: () => ({
		set: (patch: { data: Record<string, unknown> }) => ({
			where: async (condition: { value: string }) => {
				rows.set(condition.value, patch.data);
			},
		}),
	}),
	insert: () => ({
		values: async (row: { key: string; data: Record<string, unknown> }) => {
			rows.set(row.key, row.data);
		},
	}),
};

vi.mock("drizzle-orm", () => ({
	eq: (_column: unknown, value: string) => ({ value }),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: async (callback: (context: unknown) => unknown) =>
				callback({ db: fakeDb, schema: { configurations: { key: "key" } } }),
		},
	},
}));

vi.mock("@/utils/master-key", () => ({
	deleteSecret: (...args: [string]) => deleteSecret(...args),
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { listConnections, removeConnection } from "../registry";
import {
	COMPOSIO_SECRET_KEY,
	CONNECTIONS_CONFIG_KEY,
	TOOL_CACHE_CONFIG_KEY,
	type McpConnection,
} from "../types";

const connection = (overrides: Partial<McpConnection>): McpConnection => ({
	id: "c1",
	kind: "custom",
	name: "Acme",
	transport: "http",
	url: "https://mcp.acme.dev/mcp",
	authMode: "bearer",
	secretRef: "mcp_secret_c1",
	enabledByDefault: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

beforeEach(() => {
	rows.clear();
	deleteSecret.mockClear();
	rows.set(CONNECTIONS_CONFIG_KEY, {
		version: 1,
		connections: [
			connection({}),
			connection({
				id: "composio",
				kind: "composio",
				name: "Composio",
				authMode: "header",
				authHeaderName: "x-api-key",
				secretRef: "mcp_secret_composio",
				url: "https://backend.composio.dev/tool_router/trs_old/mcp",
			}),
		],
	});
	rows.set(TOOL_CACHE_CONFIG_KEY, {
		version: 1,
		entries: { composio: { tools: [], syncedAt: "2026-01-01T00:00:00.000Z" } },
	});
});

describe("removeConnection", () => {
	it("deletes the Composio project key with the connection, so a new key can be entered", async () => {
		await removeConnection("composio");

		expect((await listConnections()).map((entry) => entry.id)).toEqual(["c1"]);
		expect(rows.get(TOOL_CACHE_CONFIG_KEY)).toEqual({
			version: 1,
			entries: {},
		});
		const deleted = deleteSecret.mock.calls.map(([key]) => key).sort();
		expect(deleted).toEqual(
			["mcp_secret_composio", COMPOSIO_SECRET_KEY].sort(),
		);
	});

	it("deletes only the connection's own credential for a custom endpoint", async () => {
		await removeConnection("c1");

		expect((await listConnections()).map((entry) => entry.id)).toEqual([
			"composio",
		]);
		expect(deleteSecret.mock.calls.map(([key]) => key)).toEqual([
			"mcp_secret_c1",
		]);
	});

	it("still removes the record when the secret store refuses", async () => {
		deleteSecret.mockRejectedValueOnce(new Error("locked"));

		await expect(removeConnection("c1")).resolves.toBeUndefined();
		expect((await listConnections()).map((entry) => entry.id)).toEqual([
			"composio",
		]);
	});
});
