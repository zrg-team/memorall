import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/main/modules/agents/modals/AgentFeatureDetailModal", () => ({
	AgentFeatureDetailModal: () => null,
}));

vi.mock("@/main/stores/agent-config", async () => {
	const { create } = await import("zustand");
	const feature = (name: string, displayName: string) => ({
		name,
		displayName,
		description: `${displayName} description`,
		tools: [],
		systemPrompt: "",
	});
	const useAgentConfigStore = create<{
		featureDefinitions: ReturnType<typeof feature>[];
		draftFeatures: Record<string, boolean>;
		toggleFeature: (name: string) => void;
	}>((set, get) => ({
		featureDefinitions: [
			feature("memon-feature", "MemonOS Bot"),
			feature("web-feature", "Web Browser"),
			feature("fs-feature", "File System"),
			feature("nodejs-sandbox-feature", "Browser Sandbox"),
		],
		draftFeatures: {},
		toggleFeature: (name) =>
			set({
				draftFeatures: {
					...get().draftFeatures,
					[name]: !get().draftFeatures[name],
				},
			}),
	}));
	return { useAgentConfigStore };
});

import { useAgentConfigStore } from "@/main/stores/agent-config";
import { MemonOSSection } from "../MemonOSSection";

describe("MemonOSSection", () => {
	afterEach(() => {
		cleanup();
		useAgentConfigStore.setState({ draftFeatures: {} });
	});

	it("turns the app features on with MemonOS Bot", () => {
		render(<MemonOSSection />);

		fireEvent.click(screen.getByRole("switch", { name: "MemonOS Bot" }));

		expect(useAgentConfigStore.getState().draftFeatures).toEqual({
			"memon-feature": true,
			"web-feature": true,
			"fs-feature": true,
			"nodejs-sandbox-feature": true,
		});
		expect(
			screen.getByRole("button", {
				name: /agentSettings.memon.apps.browser.name/,
			}),
		).toHaveAttribute("aria-pressed", "true");
	});

	it("lets an app be dropped, and keeps the apps when MemonOS Bot goes off", () => {
		render(<MemonOSSection />);
		fireEvent.click(screen.getByRole("switch", { name: "MemonOS Bot" }));

		fireEvent.click(
			screen.getByRole("button", {
				name: /agentSettings.memon.apps.terminal.name/,
			}),
		);
		expect(
			useAgentConfigStore.getState().draftFeatures["nodejs-sandbox-feature"],
		).toBe(false);

		fireEvent.click(screen.getByRole("switch", { name: "MemonOS Bot" }));
		expect(useAgentConfigStore.getState().draftFeatures).toEqual({
			"memon-feature": false,
			"web-feature": true,
			"fs-feature": true,
			"nodejs-sandbox-feature": false,
		});
	});
});
