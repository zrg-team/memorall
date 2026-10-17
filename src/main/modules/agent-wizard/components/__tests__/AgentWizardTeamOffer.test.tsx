import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Flow } from "@/services/database/types";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { count?: number }) =>
			options?.count === undefined ? key : `${key}:${options.count}`,
	}),
}));
vi.mock("@/components/AgentIcon", () => ({
	AgentIcon: () => <span />,
	toAgentScreenContent: () => undefined,
}));
vi.mock("@/main/stores/favorite-agents", () => ({
	useFavoriteAgentIds: () => ["director"],
}));

import { AgentWizardTeamOffer } from "../AgentWizardTeamOffer";

const agent = (id: string, name: string): Flow =>
	({ id, name, description: `${name} does things`, metadata: {} }) as Flow;

const agents = [
	agent("writer", "Content Writer"),
	agent("researcher", "Deep Web Researcher"),
	agent("director", "Video Director"),
];

describe("the wizard's team card", () => {
	it("lists every agent, the proposed ones first and switched on", () => {
		render(
			<AgentWizardTeamOffer
				offer={{ agentIds: ["researcher"], reason: "It needs facts." }}
				agents={agents}
				onAccept={vi.fn()}
				onDismiss={vi.fn()}
			/>,
		);
		expect(screen.getByText("It needs facts.")).toBeTruthy();
		const switches = screen.getAllByRole("switch");
		// Proposed, then the starred one, then the rest.
		expect(switches.map((item) => item.getAttribute("aria-label"))).toEqual([
			"Deep Web Researcher",
			"Video Director",
			"Content Writer",
		]);
		expect(switches.map((item) => item.getAttribute("aria-checked"))).toEqual([
			"true",
			"false",
			"false",
		]);
	});

	it("adds the team as the user left it", async () => {
		const user = userEvent.setup();
		const onAccept = vi.fn();
		render(
			<AgentWizardTeamOffer
				offer={{ agentIds: ["researcher"] }}
				agents={agents}
				onAccept={onAccept}
				onDismiss={vi.fn()}
			/>,
		);
		await user.click(screen.getByText("Content Writer"));
		await user.click(
			screen.getByRole("button", { name: "wizard.teamOffer.add:2" }),
		);
		expect(onAccept).toHaveBeenCalledWith(["researcher", "writer"]);
	});

	it("cannot add an empty team, and can be dismissed", async () => {
		const user = userEvent.setup();
		const onDismiss = vi.fn();
		const view = render(
			<AgentWizardTeamOffer
				offer={{ agentIds: [] }}
				agents={agents}
				onAccept={vi.fn()}
				onDismiss={onDismiss}
			/>,
		);
		expect(
			within(view.container).getByRole("button", {
				name: "wizard.teamOffer.add:0",
			}),
		).toHaveProperty("disabled", true);
		await user.click(
			screen.getByRole("button", { name: "wizard.teamOffer.notNow" }),
		);
		expect(onDismiss).toHaveBeenCalled();
	});
});
