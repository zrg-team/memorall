import { describe, expect, it } from "vitest";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { agentTeamNames, sortFavoritesFirst } from "../agent-display";
import { agentTeamOf } from "../agent-teams";

const configWith = (
	step?: Partial<UnifiedFlowConfig["steps"][number]>,
): UnifiedFlowConfig =>
	({
		graphType: "foundation",
		steps: step ? [{ name: "multi-agent-feature", ...step }] : [],
	}) as unknown as UnifiedFlowConfig;

describe("agents in order", () => {
	const agents = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

	it("puts starred agents first, in the order they were starred", () => {
		expect(
			sortFavoritesFirst(agents, ["c", "a"]).map((agent) => agent.id),
		).toEqual(["c", "a", "b", "d"]);
	});

	it("ignores the star of an agent that is gone", () => {
		expect(
			sortFavoritesFirst(agents, ["gone", "d"]).map((agent) => agent.id),
		).toEqual(["d", "a", "b", "c"]);
	});

	it("keeps the order as it is without stars", () => {
		const sorted = sortFavoritesFirst(agents, []);
		expect(sorted).toEqual(agents);
		expect(sorted).not.toBe(agents);
	});
});

describe("a team in a line", () => {
	it("names a small team in full and counts the rest of a big one", () => {
		expect(agentTeamNames(["Writer", "Researcher", "Director"])).toBe(
			"Writer, Researcher, Director",
		);
		expect(
			agentTeamNames(["Writer", "Researcher", "Director", "Developer"]),
		).toBe("Writer, Researcher +2");
	});
});

describe("an agent's team", () => {
	it("is Multi-Agent Delegation's agents while the feature is on", () => {
		expect(
			agentTeamOf(
				configWith({
					enabled: true,
					config: { accessibleAgentIds: ["a", "b", "a", 3, ""] },
				}),
			),
		).toEqual(["a", "b"]);
	});

	it("is empty while the feature is off or missing", () => {
		expect(
			agentTeamOf(
				configWith({ enabled: false, config: { accessibleAgentIds: ["a"] } }),
			),
		).toEqual([]);
		expect(agentTeamOf(configWith())).toEqual([]);
	});
});
