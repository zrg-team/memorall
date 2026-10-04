import { describe, expect, it } from "vitest";

import {
	agentWizardToolPatchFromCall,
	applyAgentWizardPatch,
	applyAgentWizardToolPatch,
} from "../apply-agent-wizard-patch";
import { AGENT_WIZARD_TOOL_NAMES } from "../build-agent-wizard-prompt";
import {
	AGENT_WIZARD_TEMPLATES,
	createBlankAgentWizardDraft,
	draftFromTemplate,
} from "../../templates/agent-wizard-templates";

const catalog = {
	featureNames: ["knowledge-retrieval", "web-access"],
	toolNames: ["search", "read"],
	skillNames: ["writing", "coding"],
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
