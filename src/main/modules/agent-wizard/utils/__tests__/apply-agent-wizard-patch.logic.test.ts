import { describe, expect, it } from "vitest";

import {
	agentWizardToolPatchFromCall,
	applyAgentWizardPatch,
	applyAgentWizardToolPatch,
} from "../apply-agent-wizard-patch";
import {
	AGENT_WIZARD_TOOL_NAMES,
	buildAgentWizardSystemPrompt,
} from "../build-agent-wizard-prompt";
import {
	AGENT_WIZARD_TEMPLATES,
	createBlankAgentWizardDraft,
	draftFromTemplate,
} from "../../templates/agent-wizard-templates";

const catalog = {
	featureNames: ["knowledge-retrieval", "web-access"],
	toolNames: ["search", "read"],
	skillNames: ["writing", "coding"],
	agents: [{ id: "agent-1", name: "Helper", description: "" }],
} as any;

const draft = {
	name: "Old",
	description: "Old description",
	status: "draft",
	iconScreen: null,
	graphType: "agent",
	systemPrompt: "Old prompt",
	contextPrompt: "Old context",
	enabledFeatureNames: ["knowledge-retrieval"],
	enabledToolNames: [],
	enabledSkillNames: ["writing"],
	connections: [],
	multiAgentAccessibleAgentIds: [],
	cronJobs: [],
	growType: "knowledge-graph",
	recallType: "smart",
} as any;

describe("agent wizard patch helpers", () => {
	it("applies full patches and reports rejected catalog entries", () => {
		const result = applyAgentWizardPatch(
			draft,
			{
				name: "New name",
				description: "New description",
				status: "active",
				graphType: "foundation",
				systemPrompt: "New prompt",
				contextPrompt: "New context",
				enabledFeatureNames: ["web-access", "unknown-feature"],
				enabledToolNames: ["search", "unknown-tool"],
				enabledSkillNames: ["coding", "unknown-skill"],
				multiAgentAccessibleAgentIds: ["a", "a", "b"],
				connections: ["conn-a", { connectionId: "conn-b" }, 42],
			} as any,
			catalog,
		);

		expect(result.draft).toEqual(
			expect.objectContaining({
				name: "New name",
				description: "New description",
				status: "active",
				graphType: "foundation",
				systemPrompt: "New prompt",
				contextPrompt: "New context",
				enabledFeatureNames: ["web-access"],
				enabledToolNames: ["search"],
				enabledSkillNames: ["coding"],
				multiAgentAccessibleAgentIds: ["a", "b"],
				connections: [{ connectionId: "conn-a" }, { connectionId: "conn-b" }],
			}),
		);
		expect(result.notes[0]).toContain("unknown-feature");
		expect(result.notes[0]).toContain("unknown-tool");
		expect(result.notes[0]).toContain("unknown-skill");
	});

	it("starts every agent with auto-compact and thread recall, and keeps them unless asked to drop them", () => {
		expect(createBlankAgentWizardDraft().enabledFeatureNames).toEqual([
			"auto-compact",
			"thread-history-feature",
		]);
		for (const template of AGENT_WIZARD_TEMPLATES) {
			expect(draftFromTemplate(template).enabledFeatureNames).toEqual(
				expect.arrayContaining(["auto-compact", "thread-history-feature"]),
			);
		}
		const withCompact = {
			...draft,
			enabledFeatureNames: ["knowledge-retrieval", "auto-compact"],
		};
		const wizardCatalog = {
			...catalog,
			featureNames: [...catalog.featureNames, "auto-compact"],
		};
		// A list written out in full keeps it: the model listed what to add.
		expect(
			applyAgentWizardPatch(
				withCompact,
				{ enabledFeatureNames: ["web-access"] } as any,
				wizardCatalog,
			).draft.enabledFeatureNames,
		).toEqual(["web-access", "auto-compact"]);
		// Turning it off is still possible.
		expect(
			applyAgentWizardToolPatch(
				withCompact,
				{ type: "disable_feature", name: "auto-compact" } as any,
				wizardCatalog,
			).draft.enabledFeatureNames,
		).toEqual(["knowledge-retrieval"]);
	});

	it("applies tool patches for skills, features, and instructions", () => {
		expect(
			applyAgentWizardToolPatch(
				draft,
				{ type: "add_skills", skillNames: ["coding", "missing"] },
				catalog,
			),
		).toEqual({
			draft: expect.objectContaining({
				enabledSkillNames: ["writing", "coding"],
			}),
			notes: [expect.stringContaining("missing")],
		});

		expect(
			applyAgentWizardToolPatch(
				draft,
				{
					type: "enable_feature",
					name: "web-access",
					config: { tools: ["read"], accessibleAgentIds: ["agent-1"] },
				},
				catalog,
			).draft,
		).toEqual(
			expect.objectContaining({
				enabledFeatureNames: ["knowledge-retrieval", "web-access"],
				enabledToolNames: ["read"],
				multiAgentAccessibleAgentIds: ["agent-1"],
			}),
		);

		expect(
			applyAgentWizardToolPatch(
				{ ...draft, contextPrompt: "context" },
				{ type: "disable_feature", name: "knowledge-retrieval" },
				catalog,
			).draft,
		).toEqual(
			expect.objectContaining({
				enabledFeatureNames: [],
				contextPrompt: "",
			}),
		);
	});

	it("creates typed tool patches from tool calls", () => {
		expect(
			agentWizardToolPatchFromCall(AGENT_WIZARD_TOOL_NAMES.updateName, {
				name: "Agent",
			}),
		).toEqual({ type: "update_name", name: "Agent" });
		expect(
			agentWizardToolPatchFromCall(AGENT_WIZARD_TOOL_NAMES.addSkills, {
				skillNames: ["writing", 1, "writing"],
			}),
		).toEqual({ type: "add_skills", skillNames: ["writing"] });
		expect(agentWizardToolPatchFromCall("unknown", {})).toBeNull();
		expect(
			agentWizardToolPatchFromCall(AGENT_WIZARD_TOOL_NAMES.updateName, {}),
		).toBeNull();
	});
});

describe("agent wizard teams", () => {
	it("keeps only the user's own agents in a team", () => {
		const result = applyAgentWizardToolPatch(
			draft,
			{
				type: "enable_feature",
				name: "web-access",
				config: { accessibleAgentIds: ["agent-1", "made-up"] },
			},
			catalog,
		);
		expect(result.draft.multiAgentAccessibleAgentIds).toEqual(["agent-1"]);
		expect(result.notes[0]).toContain("agent: made-up");
	});

	it("reads a team proposal, which changes nothing in the draft", () => {
		const patch = agentWizardToolPatchFromCall(
			AGENT_WIZARD_TOOL_NAMES.offerTeam,
			{ agentIds: ["agent-1", "agent-1", "agent-2"], reason: "  Leads it.  " },
		);
		expect(patch).toEqual({
			type: "offer_team",
			agentIds: ["agent-1", "agent-2"],
			reason: "Leads it.",
		});
		expect(
			applyAgentWizardToolPatch(draft, patch as never, catalog).draft,
		).toEqual(draft);
	});
});

describe("agent wizard prompt teams", () => {
	const teamCatalog = {
		featureNames: ["multi-agent-feature"],
		toolNames: [],
		skillNames: [],
		connections: [],
		composioKeySaved: false,
		agents: [
			{
				id: "writer-id",
				name: "Content Writer",
				description: "Writes  blog\nposts.",
			},
		],
	};

	it("lists the user's agents and the team card, where a team can be made", () => {
		const prompt = buildAgentWizardSystemPrompt(teamCatalog, draft);
		expect(prompt).toContain("# Multi-Agent Teams");
		expect(prompt).toContain(
			"- id: writer-id | name: Content Writer | does: Writes blog posts.",
		);
		expect(prompt).toContain(AGENT_WIZARD_TOOL_NAMES.offerTeam);
	});

	it("says nothing of teams with no other agents or no delegation", () => {
		expect(
			buildAgentWizardSystemPrompt({ ...teamCatalog, agents: [] }, draft),
		).not.toContain("# Multi-Agent Teams");
		expect(
			buildAgentWizardSystemPrompt({ ...teamCatalog, featureNames: [] }, draft),
		).not.toContain("# Multi-Agent Teams");
	});
});
