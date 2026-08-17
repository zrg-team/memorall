import { describe, expect, it } from "vitest";

import {
	isProviderSelected,
	listProviderOptions,
	providerKey,
	pruneSelections,
	selectedProviders,
	toggleProvider,
} from "../scope";
import type { McpConnection } from "../types";

const base = (overrides: Partial<McpConnection> = {}): McpConnection => ({
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

const composio = (overrides: Partial<McpConnection> = {}): McpConnection =>
	base({
		id: "cx",
		kind: "composio",
		name: "Composio",
		url: "https://backend.composio.dev/tool_router/trs_all/mcp",
		apps: [
			{ id: "gmail", name: "Gmail", status: "active" },
			{ id: "github", name: "GitHub", status: "active" },
		],
		composio: { toolkits: ["gmail", "github"] },
		...overrides,
	});

describe("listProviderOptions", () => {
	it("splits a Composio credential into one row per app", () => {
		const options = listProviderOptions([composio()]);

		expect(options.map((option) => option.label)).toEqual(["Gmail", "GitHub"]);
		expect(options.map((option) => option.appId)).toEqual(["gmail", "github"]);
	});

	it("keeps a plain server as a single provider", () => {
		const options = listProviderOptions([base()]);

		expect(options).toHaveLength(1);
		expect(options[0].appId).toBeUndefined();
		expect(options[0].key).toBe("c1");
	});

	it("offers nothing for a Composio account with no authorized apps", () => {
		expect(listProviderOptions([composio({ apps: [] })])).toEqual([]);
	});

	it("hides an expired app rather than offering a grant that would fail", () => {
		const options = listProviderOptions([
			composio({
				apps: [
					{ id: "gmail", name: "Gmail", status: "expired" },
					{ id: "github", name: "GitHub", status: "active" },
				],
			}),
		]);

		expect(options.map((option) => option.appId)).toEqual(["github"]);
	});
});

describe("toggleProvider", () => {
	const [gmail, github] = listProviderOptions([composio()]);

	it("grants one app without granting its neighbours", () => {
		const next = toggleProvider([], github);

		expect(next).toEqual([{ connectionId: "cx", appIds: ["github"] }]);
		expect(isProviderSelected(next, gmail)).toBe(false);
		expect(isProviderSelected(next, github)).toBe(true);
	});

	it("adds a second app to an existing grant", () => {
		const next = toggleProvider(toggleProvider([], github), gmail);

		expect(next).toEqual([{ connectionId: "cx", appIds: ["github", "gmail"] }]);
	});

	it("drops the whole entry when the last app is turned off", () => {
		// An entry with no apps grants nothing, so persisting one would only
		// look like the agent had a connection it cannot use.
		expect(toggleProvider(toggleProvider([], github), github)).toEqual([]);
	});

	it("toggles a plain server as a whole", () => {
		const [server] = listProviderOptions([base()]);

		const on = toggleProvider([], server);
		expect(on).toEqual([{ connectionId: "c1" }]);
		expect(toggleProvider(on, server)).toEqual([]);
	});

	it("treats an app-less Composio entry as granting nothing", () => {
		expect(isProviderSelected([{ connectionId: "cx" }], gmail)).toBe(false);
	});
});

describe("selectedProviders", () => {
	it("names apps rather than the credential they came from", () => {
		const connections = [composio(), base()];
		const labels = selectedProviders(
			[{ connectionId: "cx", appIds: ["github"] }, { connectionId: "c1" }],
			connections,
		).map((provider) => provider.label);

		expect(labels).toEqual(["GitHub", "Acme Internal"]);
	});
});

describe("pruneSelections", () => {
	it("removes a grant whose app was disconnected", () => {
		const result = pruneSelections(
			[{ connectionId: "cx", appIds: ["gmail", "slack"] }],
			[composio()],
		);

		expect(result).toEqual([{ connectionId: "cx", appIds: ["gmail"] }]);
	});

	it("removes a grant whose connection is gone", () => {
		expect(pruneSelections([{ connectionId: "gone" }], [composio()])).toEqual(
			[],
		);
	});
});

describe("providerKey", () => {
	it("distinguishes two apps on the same credential", () => {
		expect(providerKey("cx", "gmail")).not.toBe(providerKey("cx", "github"));
		expect(providerKey("cx")).toBe("cx");
	});
});
