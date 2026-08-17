import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/mcp-connections", () => ({
	discoverConnection: vi.fn(),
	listConnections: vi.fn(async () => []),
	loadToolCache: vi.fn(async () => ({ version: 1, entries: {} })),
	removeConnection: vi.fn(),
	saveToolCacheEntry: vi.fn(),
	upsertConnection: vi.fn(),
}));

vi.mock("@/utils/master-key", () => ({
	isMasterKeyUnlocked: vi.fn(async () => true),
	unlockMasterKey: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { deriveStatus, useConnectionsStore } from "../connections";
import type { McpConnection } from "@/services/mcp-connections";

const connection = (overrides: Partial<McpConnection> = {}): McpConnection => ({
	id: "c1",
	kind: "custom",
	name: "Acme",
	transport: "http",
	url: "https://mcp.acme.dev/mcp",
	authMode: "none",
	enabledByDefault: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

beforeEach(() => {
	useConnectionsStore.setState({
		connections: [],
		toolCache: {},
		selectedId: null,
		unlocked: true,
		isLoading: false,
		discovering: [],
		error: null,
	});
});

describe("toolsOf", () => {
	/**
	 * Components read this inside a zustand selector. Returning a fresh array for
	 * a connection with no cached tools makes every render look like a state
	 * change and loops until React throws #185 — which is exactly what shipped.
	 */
	it("returns a stable reference when nothing is cached", () => {
		useConnectionsStore.setState({ connections: [connection()] });
		const store = useConnectionsStore.getState();

		expect(store.toolsOf("c1")).toBe(store.toolsOf("c1"));
		expect(store.toolsOf("missing")).toBe(store.toolsOf("c1"));
		expect(store.toolsOf("c1")).toEqual([]);
	});

	it("returns the cached descriptors when present", () => {
		useConnectionsStore.setState({
			connections: [connection()],
			toolCache: {
				c1: {
					descriptors: [
						{ name: "search", exposedName: "acme__search", description: "" },
					],
					discoveredAt: "2026-01-01T00:00:00.000Z",
				},
			},
		});

		expect(useConnectionsStore.getState().toolsOf("c1")).toHaveLength(1);
	});
});

describe("deriveStatus", () => {
	it("reports a connection with no endpoint as incomplete", () => {
		expect(deriveStatus(connection({ url: "" }), undefined, true)).toBe(
			"incomplete",
		);
	});

	it("reports a locked secret before any cache lookup", () => {
		expect(
			deriveStatus(
				connection({ authMode: "bearer", secretRef: "mcp_secret_c1" }),
				undefined,
				false,
			),
		).toBe("locked");
	});

	it("separates an unreachable local bridge from a remote error", () => {
		const entry = {
			descriptors: [],
			discoveredAt: "2026-01-01T00:00:00.000Z",
			error: "connect ECONNREFUSED",
		};

		expect(
			deriveStatus(
				connection({ url: "http://127.0.0.1:8000/mcp" }),
				entry,
				true,
			),
		).toBe("bridge-down");
		expect(deriveStatus(connection(), entry, true)).toBe("error");
	});

	it("reads a 401 as needing re-authorization", () => {
		expect(
			deriveStatus(
				connection(),
				{
					descriptors: [],
					discoveredAt: "2026-01-01T00:00:00.000Z",
					error: "401 Unauthorized",
				},
				true,
			),
		).toBe("needs-auth");
	});

	it("keeps a disabled connection off regardless of health", () => {
		expect(deriveStatus(connection({ disabled: true }), undefined, true)).toBe(
			"off",
		);
	});
});

describe("totalToolCount", () => {
	it("counts scoped tools and skips disabled connections", () => {
		useConnectionsStore.setState({
			connections: [
				connection({ id: "a", toolAllowlist: ["a__one"] }),
				connection({ id: "b" }),
				connection({ id: "c", disabled: true }),
			],
			toolCache: {
				a: {
					descriptors: [
						{ name: "one", exposedName: "a__one", description: "" },
						{ name: "two", exposedName: "a__two", description: "" },
					],
					discoveredAt: "2026-01-01T00:00:00.000Z",
				},
				b: {
					descriptors: [{ name: "x", exposedName: "b__x", description: "" }],
					discoveredAt: "2026-01-01T00:00:00.000Z",
				},
				c: {
					descriptors: [{ name: "y", exposedName: "c__y", description: "" }],
					discoveredAt: "2026-01-01T00:00:00.000Z",
				},
			},
		});

		expect(useConnectionsStore.getState().totalToolCount()).toBe(2);
	});
});
