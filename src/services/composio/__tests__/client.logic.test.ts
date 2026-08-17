import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { ComposioClient, ComposioError, waitForConnection } from "../client";

/**
 * These pin the request shapes to what the live API actually accepts. Every one
 * of them corresponds to a call that failed against a real project:
 * `/auth-configs` 404'd because the route is underscored, and
 * `/connected_accounts` 400'd because managed OAuth now requires the `/link`
 * endpoint with a flat body.
 */

const jsonResponse = (body: unknown, status = 200): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		statusText: "",
		json: async () => body,
		text: async () => JSON.stringify(body),
	}) as unknown as Response;

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
	return { url, init, body: init?.body ? JSON.parse(String(init.body)) : null };
};

describe("ComposioClient", () => {
	it("authenticates with x-api-key", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
		await new ComposioClient("ak_test").verifyKey();

		const { url, init } = lastCall();
		expect(url).toContain("https://backend.composio.dev/api/v3/toolkits");
		expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
			"ak_test",
		);
	});

	it("treats a 401 as an invalid key rather than an error", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 401));
		await expect(new ComposioClient("bad").verifyKey()).resolves.toBe(false);
	});

	it("uses the underscored auth_configs route", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ items: [{ id: "ac_1" }] }));
		const id = await new ComposioClient("k").ensureAuthConfig("gmail");

		expect(lastCall().url).toContain("/api/v3/auth_configs?");
		expect(lastCall().url).not.toContain("auth-configs");
		expect(id).toBe("ac_1");
	});

	it("creates an auth config only when the project has none", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ items: [] }))
			.mockResolvedValueOnce(jsonResponse({ id: "ac_new" }));

		const id = await new ComposioClient("k").ensureAuthConfig("slack");

		expect(id).toBe("ac_new");
		const { url, init, body } = lastCall();
		expect(url).toContain("/api/v3/auth_configs");
		expect(init.method).toBe("POST");
		expect(body.toolkit).toEqual({ slug: "slack" });
	});

	it("starts OAuth on /connected_accounts/link with a flat body", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				connected_account_id: "ca_1",
				redirect_url: "https://consent.example/go",
				status: "INITIATED",
			}),
		);

		const request = await new ComposioClient("k").initiateConnection({
			authConfigId: "ac_1",
			userId: "user-1",
		});

		const { url, body } = lastCall();
		expect(url).toContain("/api/v3/connected_accounts/link");
		// Flat, not { auth_config: { id }, connection: { user_id } }.
		expect(body).toMatchObject({
			auth_config_id: "ac_1",
			user_id: "user-1",
		});
		expect(body.auth_config).toBeUndefined();
		expect(request.id).toBe("ca_1");
		expect(request.redirectUrl).toBe("https://consent.example/go");
	});

	it("mints the MCP endpoint from a tool-router session", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				session_id: "sess_1",
				mcp: {
					url: "https://mcp.composio.dev/s/abc",
					headers: { "x-composio-session": "tok" },
				},
			}),
		);

		const session = await new ComposioClient("k").createMcpSession({
			userId: "user-1",
			toolkits: ["gmail", "slack"],
		});

		const { url, body } = lastCall();
		expect(url).toContain("/api/v3/tool_router/session");
		// An allowlist object; a bare array is rejected with
		// "Error in payload.toolkits: Invalid input". No `mcp` flag exists.
		expect(body).toMatchObject({
			user_id: "user-1",
			toolkits: { enable: ["gmail", "slack"] },
		});
		expect(body.mcp).toBeUndefined();
		expect(session.sessionId).toBe("sess_1");
		expect(session.url).toBe("https://mcp.composio.dev/s/abc");
		expect(session.headers).toEqual({ "x-composio-session": "tok" });
	});

	it("falls back through toolkit payload shapes until one is accepted", async () => {
		// The docs type `toolkits` as `any`, so a rejected shape must advance to
		// the next candidate rather than failing the whole setup.
		const reject = jsonResponse(
			{ error: { message: "Error in payload.toolkits: Invalid input" } },
			400,
		);
		fetchMock
			.mockResolvedValueOnce(reject)
			.mockResolvedValueOnce(reject)
			.mockResolvedValueOnce(
				jsonResponse({
					session_id: "sess_1",
					mcp: { url: "https://mcp.composio.dev/s/abc", headers: {} },
				}),
			);

		const session = await new ComposioClient("k").createMcpSession({
			userId: "u",
			toolkits: ["gmail"],
		});

		expect(session.url).toBe("https://mcp.composio.dev/s/abc");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const bodies = fetchMock.mock.calls.map(
			([, init]) => JSON.parse(String((init as RequestInit).body)).toolkits,
		);
		expect(bodies[0]).toEqual({ enable: ["gmail"] });
		expect(bodies[1]).toEqual(["gmail"]);
		expect(bodies[2]).toEqual([{ toolkit: "gmail" }]);
	});

	it("does not retry shapes when the failure is not about toolkits", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: { message: "unauthorized" } }, 401),
		);

		await expect(
			new ComposioClient("k").createMcpSession({
				userId: "u",
				toolkits: ["gmail"],
			}),
		).rejects.toBeInstanceOf(ComposioError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("surfaces the last rejection when every shape fails", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ error: { message: "Error in payload.toolkits: Invalid input" } },
				400,
			),
		);

		await expect(
			new ComposioClient("k").createMcpSession({
				userId: "u",
				toolkits: ["gmail"],
			}),
		).rejects.toThrow(/toolkits/i);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("names the status and route in errors so a wrong path is obvious", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: { message: "use /link instead" } }, 400),
		);

		await expect(
			new ComposioClient("k").initiateConnection({
				authConfigId: "ac_1",
				userId: "u",
			}),
		).rejects.toThrow(/400 on \/connected_accounts\/link/);
	});

	it("reads the toolkit slug from the nested toolkit object", async () => {
		// Reading only the flat spellings left every account without a slug, so
		// an already-authorized app showed "Connect" again on reopening.
		fetchMock.mockResolvedValue(
			jsonResponse({
				items: [
					{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } },
					{ id: "ca_2", status: "ACTIVE", toolkit_slug: "slack" },
				],
			}),
		);

		const accounts = await new ComposioClient("k").listConnectedAccounts("u");
		expect(accounts.map((a) => a.toolkitSlug)).toEqual(["gmail", "slack"]);
	});

	it("reads the logo and tool count out of the toolkit's meta object", async () => {
		// v3 nests everything descriptive under `meta`. Reading only the root left
		// every app in the catalog with no mark and no tool count.
		fetchMock.mockResolvedValue(
			jsonResponse({
				items: [
					{
						slug: "gmail",
						name: "Gmail",
						meta: {
							logo: "https://logos.composio.dev/api/gmail",
							tools_count: 61,
							description: "Google's email service",
							categories: [{ id: "email", name: "email" }],
						},
					},
				],
			}),
		);

		const [toolkit] = await new ComposioClient("k").listToolkits();
		expect(toolkit.logo).toBe("https://logos.composio.dev/api/gmail");
		expect(toolkit.toolCount).toBe(61);
		expect(toolkit.description).toBe("Google's email service");
		expect(toolkit.categories).toEqual(["email"]);
	});

	it("still reads the older flat shape", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				items: [
					{
						slug: "slack",
						name: "Slack",
						logo: "https://example.test/slack.svg",
						tools_count: 12,
						categories: ["chat"],
					},
				],
			}),
		);

		const [toolkit] = await new ComposioClient("k").listToolkits();
		expect(toolkit.logo).toBe("https://example.test/slack.svg");
		expect(toolkit.toolCount).toBe(12);
		expect(toolkit.categories).toEqual(["chat"]);
	});

	it("reads toolkits out of either envelope shape", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ data: { items: [{ slug: "gmail", name: "Gmail" }] } }),
		);
		const toolkits = await new ComposioClient("k").listToolkits();
		expect(toolkits).toEqual([
			expect.objectContaining({ slug: "gmail", name: "Gmail" }),
		]);
	});
});

describe("waitForConnection", () => {
	it("resolves once the account reports ACTIVE", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ id: "ca_1", status: "INITIATED" }))
			.mockResolvedValueOnce(jsonResponse({ id: "ca_1", status: "ACTIVE" }));

		const account = await waitForConnection(new ComposioClient("k"), "ca_1", {
			intervalMs: 1,
		});
		expect(account.status).toBe("ACTIVE");
	});

	it("gives up on a terminal failure instead of polling forever", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: "ca_1", status: "FAILED" }));

		await expect(
			waitForConnection(new ComposioClient("k"), "ca_1", { intervalMs: 1 }),
		).rejects.toBeInstanceOf(ComposioError);
	});
});
