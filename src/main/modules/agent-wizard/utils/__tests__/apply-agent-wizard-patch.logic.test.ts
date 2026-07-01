import { describe, expect, it } from "vitest";

import {
	agentWizardToolPatchFromCall,
	applyAgentWizardPatch,
	applyAgentWizardToolPatch,
} from "../apply-agent-wizard-patch";
import { AGENT_WIZARD_TOOL_NAMES } from "../build-agent-wizard-prompt";

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
	mcpServers: [],
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
				mcpServers: [
					{
						type: "http",
						name: "server",
						url: "https://example.test",
						headers: { Authorization: "Bearer token", bad: 1 },
					},
					{ type: "stdio", name: "bad", url: "bad" },
				],
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
				mcpServers: [
					{
						type: "http",
						name: "server",
						url: "https://example.test",
						headers: { Authorization: "Bearer token" },
					},
				],
			}),
		);
		expect(result.notes[0]).toContain("unknown-feature");
		expect(result.notes[0]).toContain("unknown-tool");
		expect(result.notes[0]).toContain("unknown-skill");
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
