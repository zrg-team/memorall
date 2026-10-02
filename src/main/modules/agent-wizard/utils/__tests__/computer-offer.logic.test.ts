import { describe, expect, it } from "vitest";

import {
	agentWizardToolPatchFromCall,
	applyAgentWizardToolPatch,
} from "../apply-agent-wizard-patch";
import {
	AGENT_WIZARD_TOOL_NAMES,
	buildAgentWizardSystemPrompt,
	buildAgentWizardTools,
} from "../build-agent-wizard-prompt";

const catalog = {
	featureNames: ["memon-feature", "web-feature", "fs-feature"],
	toolNames: [],
	skillNames: [],
	connections: [],
	composioKeySaved: false,
} as any;

const draft = {
	name: "House reviewer",
	enabledFeatureNames: ["web-feature"],
} as any;

describe("offering MemonOS Bot in the agent wizard", () => {
	it("reads the offer, keeping only apps the computer has", () => {
		expect(
			agentWizardToolPatchFromCall(AGENT_WIZARD_TOOL_NAMES.offerComputer, {
				apps: ["browser", "files", "printer", "browser"],
				reason: "  It browses listings and saves photos.  ",
			}),
		).toEqual({
			type: "offer_computer",
			apps: ["browser", "files"],
			reason: "It browses listings and saves photos.",
		});
	});

	it("leaves the draft alone: the user turns it on from the card", () => {
		const result = applyAgentWizardToolPatch(
			draft,
			{ type: "offer_computer", apps: ["browser"] },
			catalog,
		);
		expect(result.draft.enabledFeatureNames).toEqual(["web-feature"]);
	});

	it("tells the wizard to offer it with the card, not a form", () => {
		const prompt = buildAgentWizardSystemPrompt(catalog, draft);
		expect(prompt).toContain("# MemonOS Bot");
		expect(prompt).toContain(AGENT_WIZARD_TOOL_NAMES.offerComputer);
		expect(prompt).toContain('do NOT enable "memon-feature" yourself');
		expect(
			buildAgentWizardTools().some(
				(tool) => tool.function.name === AGENT_WIZARD_TOOL_NAMES.offerComputer,
			),
		).toBe(true);
	});

	it("says nothing about it where the catalog has no MemonOS Bot", () => {
		const prompt = buildAgentWizardSystemPrompt(
			{ ...catalog, featureNames: ["web-feature"] },
			draft,
		);
		expect(prompt).not.toContain("# MemonOS Bot");
	});
});
