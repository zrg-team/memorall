import { describe, expect, it } from "vitest";
import type { UsageMessageRow } from "../../types";
import {
	createFeatureResolver,
	OTHER_FEATURE,
	sourceFeatureKey,
} from "../usage-features";
import {
	readRequestTokens,
	readToolInputs,
	toUsageRequests,
} from "../usage-records";

const resolve = createFeatureResolver([
	{ key: "web", label: "Web Browser", tools: ["web_search", "web_read"] },
	{
		key: "meals",
		label: "Meal Planner",
		tools: ["meal_plan", "meal_list", "web_search"],
	},
]);

const row = (overrides: Partial<UsageMessageRow>): UsageMessageRow => ({
	id: "m1",
	conversationId: "c1",
	createdAt: "2026-10-04 08:30:00",
	conversationTitle: "Chat",
	flowName: null,
	agentName: null,
	model: "gpt-5.6-terra",
	provider: "openai",
	usage: null,
	toolExecutions: [],
	parts: [],
	...overrides,
});

describe("reading saved usage", () => {
	it("treats a reply without per-request calls as one request", () => {
		expect(
			readRequestTokens({ prompt_tokens: 10, completion_tokens: 5, cost: 0.1 }),
		).toEqual([
			{
				input: 10,
				cached: 0,
				output: 5,
				reasoning: 0,
				cost: 0.1,
				estimated: false,
			},
		]);
		expect(
			readRequestTokens({ prompt_tokens: 0, completion_tokens: 0 }),
		).toEqual([]);
		expect(readRequestTokens("not usage")).toEqual([]);
	});

	it("spreads a reply-level cost over its requests by size", () => {
		const calls = readRequestTokens({
			cost: 0.3,
			calls: [
				{ prompt_tokens: 100, completion_tokens: 0 },
				{ prompt_tokens: 200, completion_tokens: 0 },
			],
		});
		expect(calls.map((call) => call.cost)).toEqual([0.1, 0.2]);
	});

	it("groups tool results by the request that read them", () => {
		const { segments, names } = readToolInputs([
			{ r: "assistant", c: [{ id: "a", name: "web_search" }] },
			{ r: "tool", id: "a", n: 10 },
			{ r: "assistant", c: null },
			{ r: "tool", id: "never-read", n: 99 },
		]);
		expect(segments).toEqual([[], [{ id: "a", chars: 10 }]]);
		expect(names.get("a")).toBe("web_search");
	});

	it("reads timestamps without a zone as UTC", () => {
		const [request] = toUsageRequests(
			row({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
			resolve,
		);
		expect(request?.at).toBe(Date.UTC(2026, 9, 4, 8, 30));
	});
});

describe("attributing requests to tools", () => {
	it("matches requests to assistant parts from the end", () => {
		// Two context requests ran before the agent; only the last two had parts.
		const requests = toUsageRequests(
			row({
				usage: {
					calls: [
						{ prompt_tokens: 5, completion_tokens: 1 },
						{ prompt_tokens: 5, completion_tokens: 1 },
						{ prompt_tokens: 10, completion_tokens: 1 },
						{ prompt_tokens: 20, completion_tokens: 1 },
					],
				},
				parts: [
					{ r: "assistant", c: [{ id: "t1", name: "web_read" }] },
					{ r: "tool", id: "t1", n: 40 },
					{ r: "assistant" },
				],
			}),
			resolve,
		);
		expect(requests.map((request) => request.tools.map((t) => t.tool))).toEqual(
			[[], [], [], ["web_read"]],
		);
	});

	it("shares later requests across every tool run when parts are missing", () => {
		const requests = toUsageRequests(
			row({
				usage: {
					calls: [
						{ prompt_tokens: 5, completion_tokens: 1 },
						{ prompt_tokens: 5, completion_tokens: 1 },
						{ prompt_tokens: 5, completion_tokens: 1 },
					],
				},
				toolExecutions: [
					{ id: "x", name: "web_search" },
					{ id: "y", name: "srv__lookup", source: "mcp" },
				],
			}),
			resolve,
		);
		expect(requests[0]?.tools).toEqual([]);
		expect(requests[1]?.tools.map((t) => [t.tool, t.weight, t.calls])).toEqual([
			["web_search", 0.5, 1],
			["srv__lookup", 0.5, 1],
		]);
		// The same runs again, without counting the calls twice.
		expect(requests[2]?.tools.map((t) => t.calls)).toEqual([0, 0]);
		expect(requests[1]?.tools[1]?.feature).toBe(sourceFeatureKey("mcp"));
	});

	it("prices local models at zero and keeps unpriced remote requests unpriced", () => {
		const [local] = toUsageRequests(
			row({
				provider: "wllama",
				usage: { prompt_tokens: 3, completion_tokens: 1 },
			}),
			resolve,
		);
		const [remote] = toUsageRequests(
			row({ usage: { prompt_tokens: 3, completion_tokens: 1 } }),
			resolve,
		);
		expect(local).toMatchObject({ local: true, cost: 0 });
		expect(remote?.local).toBe(false);
		expect(remote?.cost).toBeUndefined();
	});
});

describe("resolving a tool's feature", () => {
	it("prefers the feature whose own tools share the prefix", () => {
		expect(resolve("web_search")).toBe("web");
		expect(resolve("meal_plan")).toBe("meals");
	});

	it("falls back to the tool's source, then to other", () => {
		expect(resolve("srv__lookup", "mcp")).toBe("source:mcp");
		expect(resolve("calculator")).toBe(OTHER_FEATURE);
	});
});
