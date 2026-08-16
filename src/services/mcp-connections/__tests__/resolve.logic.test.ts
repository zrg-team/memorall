import { beforeEach, describe, expect, it, vi } from "vitest";

const listConnections = vi.fn();
const loadSecret = vi.fn();

vi.mock("../registry", () => ({
	listConnections: (...args: unknown[]) => listConnections(...args),
}));

vi.mock("@/utils/master-key", () => ({
	loadSecret: (...args: unknown[]) => loadSecret(...args),
}));

vi.mock("@/utils/logger", () => ({
	logWarn: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { resolveConnections, withResolvedConnections } from "../resolve";
import type { McpConnection } from "../types";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";

const connection = (overrides: Partial<McpConnection> = {}): McpConnection => ({
	id: "c1",
	kind: "custom",
	name: "Acme Internal",
	transport: "http",
	url: "https://mcp.acme.dev/mcp",
	authMode: "none",
	enabledByDefault: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

const configWith = (stepConfig: Record<string, unknown>): UnifiedFlowConfig =>
	({
		graphType: "foundation",
		steps: [
			{ id: "s0", name: "add-system", enabled: true, config: {} },
			{ id: "s1", name: "mcp-feature", enabled: true, config: stepConfig },
		],
	}) as unknown as UnifiedFlowConfig;

beforeEach(() => {
	listConnections.mockReset();
	loadSecret.mockReset();
});

describe("resolveConnections", () => {
	it("derives a server key from the name so tools are prefixed predictably", async () => {
		listConnections.mockResolvedValue([connection()]);

		const result = await resolveConnections([{ connectionId: "c1" }]);

		expect(result.servers).toEqual([
			{
				type: "http",
				name: "acme-internal",
				url: "https://mcp.acme.dev/mcp",
				headers: {},
			},
		]);
		expect(result.skipped).toEqual([]);
	});

	it("assembles bearer auth into a header without persisting the secret", async () => {
		listConnections.mockResolvedValue([
			connection({ authMode: "bearer", secretRef: "mcp_secret_c1" }),
		]);
		loadSecret.mockResolvedValue("tok_123");

		const result = await resolveConnections([{ connectionId: "c1" }]);

		expect(result.servers[0].headers).toEqual({
			Authorization: "Bearer tok_123",
		});
		expect(loadSecret).toHaveBeenCalledWith("mcp_secret_c1");
	});

	it("puts query-param auth on the URL", async () => {
		listConnections.mockResolvedValue([
			connection({
				authMode: "query",
				authQueryParam: "api_key",
				secretRef: "mcp_secret_c1",
			}),
		]);
		loadSecret.mockResolvedValue("abc");

		const result = await resolveConnections([{ connectionId: "c1" }]);

		expect(result.servers[0].url).toBe("https://mcp.acme.dev/mcp?api_key=abc");
	});

	it("skips a connection whose credential cannot be read", async () => {
		listConnections.mockResolvedValue([
			connection({ authMode: "bearer", secretRef: "mcp_secret_c1" }),
		]);
		loadSecret.mockRejectedValue(new Error("Master key is not unlocked"));

		const result = await resolveConnections([{ connectionId: "c1" }]);

		expect(result.servers).toEqual([]);
		expect(result.skipped).toEqual(["c1"]);
	});

	it("ignores disabled connections and unknown ids", async () => {
		listConnections.mockResolvedValue([connection({ disabled: true })]);

		const result = await resolveConnections([
			{ connectionId: "c1" },
			{ connectionId: "nope" },
		]);

		expect(result.servers).toEqual([]);
	});

	it("disambiguates server keys when two names collide", async () => {
		listConnections.mockResolvedValue([
			connection({ id: "c1", name: "Acme" }),
			connection({ id: "c2", name: "acme", url: "https://other.dev/mcp" }),
		]);

		const result = await resolveConnections([
			{ connectionId: "c1" },
			{ connectionId: "c2" },
		]);

		expect(result.servers.map((server) => server.name)).toEqual([
			"acme",
			"acme-2",
		]);
	});

	it("prefixes a per-agent allowlist with the server key", async () => {
		listConnections.mockResolvedValue([connection()]);

		const result = await resolveConnections([
			{ connectionId: "c1", toolAllowlist: ["search_orders"] },
		]);

		expect(result.toolAllowlist).toEqual(["acme-internal__search_orders"]);
	});

	it("leaves an already-prefixed allowlist alone", async () => {
		listConnections.mockResolvedValue([connection()]);

		const result = await resolveConnections([
			{ connectionId: "c1", toolAllowlist: ["acme-internal__search_orders"] },
		]);

		expect(result.toolAllowlist).toEqual(["acme-internal__search_orders"]);
	});
});

describe("withResolvedConnections", () => {
	it("returns the config untouched when no connections are selected", async () => {
		const config = configWith({});
		await expect(withResolvedConnections(config)).resolves.toBe(config);
		expect(listConnections).not.toHaveBeenCalled();
	});

	it("fills servers into the mcp-feature step", async () => {
		listConnections.mockResolvedValue([connection()]);

		const result = await withResolvedConnections(
			configWith({ connections: [{ connectionId: "c1" }] }),
		);

		const step = result.steps.find((entry) => entry.name === "mcp-feature");
		expect(step?.enabled).toBe(true);
		expect(step?.config?.servers).toHaveLength(1);
	});

	it("disables the step when nothing resolves, so no empty MCP preamble is added", async () => {
		listConnections.mockResolvedValue([
			connection({ authMode: "bearer", secretRef: "mcp_secret_c1" }),
		]);
		loadSecret.mockRejectedValue(new Error("Master key is not unlocked"));

		const result = await withResolvedConnections(
			configWith({ connections: [{ connectionId: "c1" }] }),
		);

		const step = result.steps.find((entry) => entry.name === "mcp-feature");
		expect(step?.enabled).toBe(false);
		expect(step?.config?.servers).toEqual([]);
	});

	it("never throws a registry failure into the chat run", async () => {
		listConnections.mockRejectedValue(new Error("database is gone"));
		const config = configWith({ connections: [{ connectionId: "c1" }] });

		await expect(withResolvedConnections(config)).resolves.toBe(config);
	});
});
