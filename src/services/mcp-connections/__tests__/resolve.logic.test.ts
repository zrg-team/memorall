import { beforeEach, describe, expect, it, vi } from "vitest";

const listConnections = vi.fn();
const upsertConnection = vi.fn();
const loadSecret = vi.fn();
const createMcpSession = vi.fn();

vi.mock("../registry", () => ({
	listConnections: (...args: unknown[]) => listConnections(...args),
	upsertConnection: (...args: unknown[]) => upsertConnection(...args),
}));

vi.mock("@/services/composio", () => ({
	ComposioClient: class {
		createMcpSession(...args: unknown[]) {
			return createMcpSession(...args);
		}
	},
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

import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	composioPreloadTools,
	composioToolScope,
	resolveConnections,
	withResolvedConnections,
} from "../resolve";
import type { McpConnection } from "../types";

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

/**
 * A Composio account with three authorized apps — the shape the scoping rules
 * exist for. `composio.toolkits` is what the connection's own session carries.
 */
const composioConnection = (
	overrides: Partial<McpConnection> = {},
): McpConnection =>
	connection({
		kind: "composio",
		name: "Composio",
		url: "https://backend.composio.dev/tool_router/trs_all/mcp",
		apps: [
			{ id: "gmail", name: "Gmail", status: "active" },
			{ id: "googlecalendar", name: "Google Calendar", status: "active" },
			{ id: "github", name: "GitHub", status: "active" },
		],
		composio: { toolkits: ["gmail", "googlecalendar", "github"] },
		...overrides,
	});

beforeEach(() => {
	listConnections.mockReset();
	upsertConnection.mockReset();
	upsertConnection.mockResolvedValue(undefined);
	loadSecret.mockReset();
	createMcpSession.mockReset();
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

	it("repairs an older Composio record that was saved without auth", async () => {
		// Records written before the endpoint's auth requirement was understood
		// have authMode "none". They must still authenticate rather than 401.
		listConnections.mockResolvedValue([
			composioConnection({ authMode: "none" }),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([
			{
				connectionId: "c1",
				appIds: ["gmail", "googlecalendar", "github"],
			},
		]);

		expect(loadSecret).toHaveBeenCalledWith("composio_config");
		expect(result.servers[0].headers).toEqual({ "x-api-key": "ak_live_123" });
	});

	it("leaves a non-Composio connection without auth alone", async () => {
		listConnections.mockResolvedValue([connection({ authMode: "none" })]);
		const result = await resolveConnections([{ connectionId: "c1" }]);
		expect(result.servers[0].headers).toEqual({});
	});

	it("sends Composio's key as x-api-key on the session endpoint", async () => {
		// The tool-router MCP URL is not public: without a header it answers 401,
		// which the MCP client retries as SSE and reports as a confusing 404.
		listConnections.mockResolvedValue([
			composioConnection({
				authMode: "header",
				authHeaderName: "x-api-key",
				secretRef: "mcp_secret_c1",
			}),
		]);
		loadSecret.mockResolvedValue("ak_live_123");

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["gmail", "googlecalendar", "github"] },
		]);

		expect(result.servers[0].headers).toEqual({ "x-api-key": "ak_live_123" });
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

	it("mints a session for exactly the apps an agent was granted", async () => {
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockResolvedValue({
			sessionId: "trs_github",
			url: "https://backend.composio.dev/tool_router/trs_github/mcp",
		});

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["github"] },
		]);

		expect(createMcpSession).toHaveBeenCalledWith(
			expect.objectContaining({ toolkits: ["github"] }),
		);
		expect(result.servers[0].url).toBe(
			"https://backend.composio.dev/tool_router/trs_github/mcp",
		);
		// The scope is cached so a second run does not mint again.
		expect(upsertConnection).toHaveBeenCalledWith(
			expect.objectContaining({
				composio: expect.objectContaining({
					scopedSessions: {
						"github|router|":
							"https://backend.composio.dev/tool_router/trs_github/mcp",
					},
				}),
			}),
		);
	});

	it("reuses a cached session rather than minting per run", async () => {
		listConnections.mockResolvedValue([
			composioConnection({
				composio: {
					toolkits: ["gmail", "googlecalendar", "github"],
					scopedSessions: {
						"github|router|":
							"https://backend.composio.dev/tool_router/trs_cached/mcp",
					},
				},
			}),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["github"] },
		]);

		expect(createMcpSession).not.toHaveBeenCalled();
		expect(result.servers[0].url).toBe(
			"https://backend.composio.dev/tool_router/trs_cached/mcp",
		);
	});

	it("preloads the tools an agent was scoped to", async () => {
		// Left to the router, GITHUB_GET_A_REPOSITORY is reachable only through
		// COMPOSIO_MULTI_EXECUTE_TOOL's open `arguments` object, which `{}`
		// satisfies. Preloaded, it is served as itself with `owner` and `repo`
		// required, and an empty call stops being expressible.
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockResolvedValue({
			sessionId: "trs_direct",
			url: "https://backend.composio.dev/tool_router/trs_direct/mcp",
			preloadedTools: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"],
		});

		await resolveConnections([
			{
				connectionId: "c1",
				appIds: ["github"],
				toolAllowlist: [
					"acme-internal__GITHUB_GET_A_REPOSITORY",
					"acme-internal__GITHUB_LIST_BRANCHES",
				],
			},
		]);

		expect(createMcpSession).toHaveBeenCalledWith(
			expect.objectContaining({
				toolkits: ["github"],
				preloadTools: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"],
				tools: {
					github: {
						enable: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"],
					},
				},
			}),
		);
	});

	it("preloads nothing when the agent picked whole apps", async () => {
		// Preloading a whole toolkit would put a hundred tool definitions in the
		// model's context on every request.
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockResolvedValue({
			sessionId: "trs_router",
			url: "https://backend.composio.dev/tool_router/trs_router/mcp",
			preloadedTools: [],
		});

		await resolveConnections([{ connectionId: "c1", appIds: ["github"] }]);

		expect(createMcpSession.mock.calls[0][0].preloadTools).toBeUndefined();
		expect(createMcpSession.mock.calls[0][0].tools).toBeUndefined();
	});

	it("does not hand a cached router session to a request that wants preloads", async () => {
		listConnections.mockResolvedValue([
			composioConnection({
				composio: {
					toolkits: ["github"],
					scopedSessions: {
						"github|router|":
							"https://backend.composio.dev/tool_router/trs_router/mcp",
					},
				},
			}),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockResolvedValue({
			sessionId: "trs_direct",
			url: "https://backend.composio.dev/tool_router/trs_direct/mcp",
			preloadedTools: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"],
		});

		const result = await resolveConnections([
			{
				connectionId: "c1",
				appIds: ["github"],
				toolAllowlist: ["acme-internal__GITHUB_GET_A_REPOSITORY"],
			},
		]);

		expect(createMcpSession).toHaveBeenCalledTimes(1);
		expect(result.servers[0].url).toBe(
			"https://backend.composio.dev/tool_router/trs_direct/mcp",
		);
	});

	it("gives two agents different endpoints for different apps", async () => {
		// The guarantee the whole feature rests on: an agent scoped to GitHub
		// cannot reach Calendar, because Calendar is not in its session.
		listConnections.mockResolvedValue([
			composioConnection({
				composio: {
					toolkits: ["gmail", "googlecalendar", "github"],
					scopedSessions: {
						"github|router|":
							"https://backend.composio.dev/tool_router/trs_gh/mcp",
						"googlecalendar|router|":
							"https://backend.composio.dev/tool_router/trs_cal/mcp",
					},
				},
			}),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const github = await resolveConnections([
			{ connectionId: "c1", appIds: ["github"] },
		]);
		const calendar = await resolveConnections([
			{ connectionId: "c1", appIds: ["googlecalendar"] },
		]);

		expect(github.servers[0].url).not.toBe(calendar.servers[0].url);
	});

	it("grants nothing when a Composio connection names no apps", async () => {
		// Attaching the credential is not consent to every app on it — otherwise
		// authorizing a new app would silently widen every existing agent.
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([{ connectionId: "c1" }]);

		expect(result.servers).toEqual([]);
		expect(result.skipped).toEqual(["c1"]);
		expect(createMcpSession).not.toHaveBeenCalled();
	});

	it("drops the connection when a scoped session cannot be minted", async () => {
		// Falling back to the full session here would hand an agent scoped to
		// GitHub every app on the key. No tools is the safe failure.
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockRejectedValue(new Error("429 rate limited"));

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["github"] },
		]);

		expect(result.servers).toEqual([]);
		expect(result.skipped).toEqual(["c1"]);
	});

	it("ignores an app the user has since disconnected", async () => {
		listConnections.mockResolvedValue([
			composioConnection({
				apps: [{ id: "github", name: "GitHub", status: "active" }],
				composio: { toolkits: ["github"] },
			}),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["github", "gmail"] },
		]);

		// Only GitHub survives, and that is the whole of the record's session.
		expect(createMcpSession).not.toHaveBeenCalled();
		expect(result.servers[0].url).toBe(
			"https://backend.composio.dev/tool_router/trs_all/mcp",
		);
	});

	it("never narrows Composio by tool name, which cannot express app scope", async () => {
		// The router's tools are named the same whatever app they reach, so a
		// name filter here would remove all of them and leave the agent empty.
		listConnections.mockResolvedValue([composioConnection()]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["gmail", "googlecalendar", "github"] },
		]);

		expect(result.toolAllowlist).toEqual([]);
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

	it("projects a saved agent config into a runnable step", async () => {
		// End of the chain the feature actually lives on: what an agent persists
		// (`connections`) becomes what the step runs (`servers`), enabled, with
		// the scoped endpoint. Every earlier step can look right while this is
		// empty, which is exactly how the tools went missing before.
		listConnections.mockResolvedValue([
			composioConnection({
				composio: {
					toolkits: ["gmail", "googlecalendar", "github"],
					scopedSessions: {
						"github|router|":
							"https://backend.composio.dev/tool_router/trs_gh/mcp",
					},
				},
			}),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await withResolvedConnections(
			configWith({
				connections: [{ connectionId: "c1", appIds: ["github"] }],
			}),
		);

		const step = result.steps.find((entry) => entry.name === "mcp-feature");
		expect(step?.enabled).toBe(true);
		expect(step?.config?.servers).toEqual([
			{
				type: "http",
				name: "composio",
				url: "https://backend.composio.dev/tool_router/trs_gh/mcp",
				headers: { "x-api-key": "ak_live_123" },
			},
		]);
	});

	it("enables the step from the selection alone, not a separate toggle", async () => {
		// Choosing connections IS the intent to use them. Requiring the feature
		// switch as well let an agent show its providers attached and still run
		// with no tools.
		listConnections.mockResolvedValue([connection()]);

		const config = configWith({ connections: [{ connectionId: "c1" }] });
		config.steps[1].enabled = false;

		const result = await withResolvedConnections(config);

		expect(
			result.steps.find((entry) => entry.name === "mcp-feature")?.enabled,
		).toBe(true);
	});

	it("never throws a registry failure into the chat run", async () => {
		listConnections.mockRejectedValue(new Error("database is gone"));
		const config = configWith({ connections: [{ connectionId: "c1" }] });

		await expect(withResolvedConnections(config)).resolves.toBe(config);
	});
});

describe("composioToolScope", () => {
	it("groups server-prefixed names into the shape a session wants", () => {
		expect(
			composioToolScope(
				[
					"acme__GITHUB_GET_A_REPOSITORY",
					"acme__GOOGLECALENDAR_CREATE_EVENT",
					"acme__GITHUB_LIST_BRANCHES",
				],
				["github", "googlecalendar"],
			),
		).toEqual({
			github: {
				enable: ["GITHUB_GET_A_REPOSITORY", "GITHUB_LIST_BRANCHES"],
			},
			googlecalendar: { enable: ["GOOGLECALENDAR_CREATE_EVENT"] },
		});
	});

	it("never widens the session past the apps the agent was granted", () => {
		// An allowlist is a narrowing. A tool for an app the agent was not given
		// must not be able to pull that app into the session.
		expect(
			composioToolScope(
				["acme__GITHUB_GET_A_REPOSITORY", "acme__SLACK_SEND_MESSAGE"],
				["github"],
			),
		).toEqual({ github: { enable: ["GITHUB_GET_A_REPOSITORY"] } });
	});

	it("has no scope to express when the agent was picked by app", () => {
		expect(composioToolScope(undefined, ["github"])).toBeUndefined();
		expect(composioToolScope([], ["github"])).toBeUndefined();
		// Every named tool belongs to an app that was not granted.
		expect(
			composioToolScope(["acme__SLACK_SEND_MESSAGE"], ["github"]),
		).toBeUndefined();
	});

	it("tolerates an unprefixed name and does not repeat a tool", () => {
		expect(
			composioToolScope(
				["GITHUB_GET_A_REPOSITORY", "acme__GITHUB_GET_A_REPOSITORY"],
				["github"],
			),
		).toEqual({ github: { enable: ["GITHUB_GET_A_REPOSITORY"] } });
	});
});

describe("composioPreloadTools", () => {
	it("flattens the scope into the slug list a session preloads", () => {
		expect(
			composioPreloadTools({
				github: { enable: ["GITHUB_LIST_BRANCHES", "GITHUB_GET_A_REPOSITORY"] },
				googlecalendar: { enable: ["GOOGLECALENDAR_CREATE_EVENT"] },
			}),
		).toEqual([
			"GITHUB_GET_A_REPOSITORY",
			"GITHUB_LIST_BRANCHES",
			"GOOGLECALENDAR_CREATE_EVENT",
		]);
	});

	it("preloads nothing for an agent scoped by app", () => {
		expect(composioPreloadTools(undefined)).toEqual([]);
	});
});

describe("Composio router tool scope", () => {
	const routerTool = (slug: string) => `composio__${slug}`;
	const recommended = [
		"COMPOSIO_SEARCH_TOOLS",
		"COMPOSIO_GET_TOOL_SCHEMAS",
		"COMPOSIO_MULTI_EXECUTE_TOOL",
	].map(routerTool);

	it("honours the connection's choice of router meta-tools", async () => {
		// The six router tools are named the same whatever app the session
		// reaches, so unlike app scope (a session property) which of them the
		// model sees IS expressible by name — and the Recommended preset relies
		// on it to drop the three heavy, rarely wanted ones.
		listConnections.mockResolvedValue([
			composioConnection({ toolAllowlist: recommended }),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));

		const result = await resolveConnections([
			{ connectionId: "c1", appIds: ["gmail", "googlecalendar", "github"] },
		]);

		expect(result.servers).toHaveLength(1);
		expect(result.toolAllowlist).toEqual(recommended);
	});

	it("lets an agent's own tool scope override the connection preset", async () => {
		listConnections.mockResolvedValue([
			composioConnection({ toolAllowlist: recommended }),
		]);
		loadSecret.mockResolvedValue(JSON.stringify({ apiKey: "ak_live_123" }));
		createMcpSession.mockResolvedValue({
			sessionId: "trs_direct",
			url: "https://backend.composio.dev/tool_router/trs_direct/mcp",
			preloadedTools: ["GITHUB_GET_A_REPOSITORY"],
		});

		const result = await resolveConnections([
			{
				connectionId: "c1",
				appIds: ["github"],
				toolAllowlist: ["composio__GITHUB_GET_A_REPOSITORY"],
			},
		]);

		expect(result.toolAllowlist).toEqual(["composio__GITHUB_GET_A_REPOSITORY"]);
	});
});
