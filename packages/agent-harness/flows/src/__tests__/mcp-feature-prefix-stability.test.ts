import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tool definitions render at position 0 of every request, ahead of the system
 * prompt and the whole conversation. A change to them is the one edit no model
 * can cache around: it forces a full rebuild. An MCP server that drops out
 * mid-session used to take its tools with it and cost exactly that — twice,
 * once on the way out and once on the way back.
 */

const discover = vi.fn();
const close = vi.fn(async () => undefined);

vi.mock("@memorall/agent-harness-mcp", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@memorall/agent-harness-mcp")>();
	return {
		...actual,
		McpClientManager: class {
			discover = discover;
			close = close;
			callTool = vi.fn();
		},
	};
});

const descriptorFor = (serverId: string, name: string) => ({
	serverId,
	name,
	exposedName: `${serverId}__${name}`,
	description: `${name} from ${serverId}`,
	inputSchema: { type: "object", properties: {} },
});

const SERVERS = [
	{ name: "srv", type: "http" as const, url: "https://example.test/mcp" },
];

const runFeature = async () => {
	const { stepRegistry } = await import("../registries/step-registry.js");
	await import("../steps/features/mcp-feature/mcp-feature.js");
	const step = stepRegistry
		.get("mcp-feature")
		?.factory?.(undefined as never, { servers: SERVERS });
	if (!step) throw new Error("mcp-feature step is not registered");
	const result = await (
		step as {
			execute: (input: {
				messages: unknown[];
				tools: unknown[];
			}) => Promise<{ output?: { tools?: { name: string }[] } }>;
		}
	).execute({ messages: [{ role: "user", content: "hi" }], tools: [] });
	return (result.output?.tools ?? []).map((tool) => tool.name);
};

describe("mcp-feature tool-definition stability", () => {
	beforeEach(() => {
		// Sessions and the last-known-tools map are module state, so each case
		// needs a fresh module graph to start from a cold cache.
		vi.resetModules();
		vi.useFakeTimers();
		discover.mockReset();
		close.mockReset();
	});

	it("keeps a server's tools in the prefix when it fails to reconnect", async () => {
		discover.mockResolvedValueOnce([
			descriptorFor("srv", "alpha"),
			descriptorFor("srv", "beta"),
		]);
		const connected = await runFeature();
		expect(connected).toEqual(["srv__alpha", "srv__beta"]);

		// The session idles out, and the server is unreachable when the next
		// message re-opens it.
		await vi.advanceTimersByTimeAsync(6 * 60_000);
		discover.mockRejectedValueOnce(new Error("ECONNREFUSED"));

		// Same tools, same order: the prefix the provider cached still matches.
		expect(await runFeature()).toEqual(connected);
	});

	it("honours a genuine tool-list change from a server that answers", async () => {
		discover.mockResolvedValueOnce([descriptorFor("srv", "alpha")]);
		expect(await runFeature()).toEqual(["srv__alpha"]);

		await vi.advanceTimersByTimeAsync(6 * 60_000);
		discover.mockResolvedValueOnce([
			descriptorFor("srv", "alpha"),
			descriptorFor("srv", "gamma"),
		]);

		// A reachable server that reports a different list has really changed.
		// Pinning that too would serve definitions the server no longer honours.
		expect(await runFeature()).toEqual(["srv__alpha", "srv__gamma"]);
	});
});
