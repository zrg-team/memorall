import React from "react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	initializeAgent: vi.fn(),
	initializeSkills: vi.fn(),
	toggleSkill: vi.fn(),
	pickFiles: vi.fn(),
}));

vi.mock("@/main/stores/chat", async () => {
	const { create } = await import("zustand");
	return {
		useChatStore: create<{
			selectedAgentFlowId: string | null;
			setSelectedAgentFlowId: (id: string | null) => void;
		}>((set) => ({
			selectedAgentFlowId: "agent-a",
			setSelectedAgentFlowId: (id) => set({ selectedAgentFlowId: id }),
		})),
	};
});
vi.mock("@/main/stores/agent-config", async () => {
	const { create } = await import("zustand");
	return {
		useAgentConfigStore: create(() => ({
			currentFlowId: "agent-a",
			draftEnabledSkillNames: ["humanizer"],
			isLoading: false,
			error: null,
			savedUnifiedConfig: {},
			availableAgents: [
				{ id: "agent-a", name: "Researcher" },
				{ id: "agent-b", name: "Writer" },
			],
			initialize: mocks.initializeAgent,
			toggleSkill: mocks.toggleSkill,
		})),
	};
});
vi.mock("@/main/stores/skills", async () => {
	const { create } = await import("zustand");
	return {
		useSkillsStore: create(() => ({
			skills: ["humanizer", "writer"].map((name) => ({ name })),
			selected: { name: "humanizer" },
			lane: null,
			pendingImport: null,
			isLoading: false,
			initialize: mocks.initializeSkills,
			refresh: vi.fn(),
			select: vi.fn(),
			openLane: vi.fn(),
			setPendingImport: vi.fn(),
			commitImport: vi.fn(),
		})),
	};
});
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { enabled?: number }) =>
			key === "description" ? `${options?.enabled} enabled` : key,
	}),
}));
vi.mock("@/main/modules/skills", () => ({
	AddSkillButton: () => null,
	AddSkillChooser: () => null,
	CreateSkillForm: () => null,
	GithubImportForm: () => null,
	SkillImportReview: () => null,
	SkillsSidebar: ({
		enabledSkillNames,
	}: {
		enabledSkillNames: Set<string>;
	}) => <div data-testid="in-use">{[...enabledSkillNames].join(",")}</div>,
	SkillDetail: ({
		enabled,
		enabledLoading,
		enabledDisabled,
		agentName,
		onToggleEnabled,
	}: {
		enabled: boolean;
		enabledLoading: boolean;
		enabledDisabled: boolean;
		agentName: string;
		onToggleEnabled: (name: string) => void;
	}) => (
		<button
			type="button"
			disabled={enabledDisabled}
			aria-busy={enabledLoading}
			data-enabled={enabled}
			onClick={() => onToggleEnabled("humanizer")}
		>
			{agentName}
		</button>
	),
	useSkillImport: () => ({
		isPlanning: false,
		pickFiles: mocks.pickFiles,
		planFromDrop: vi.fn(),
	}),
}));

import { SkillsPage } from "../SkillsPage";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useChatStore } from "@/main/stores/chat";

describe("SkillsPage follows the chat agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAgentConfigStore.setState(useAgentConfigStore.getInitialState(), true);
		useChatStore.setState({ selectedAgentFlowId: "agent-a" });
	});
	afterEach(cleanup);

	it("switches assignments and the open skill's toggle when the chat input selects another agent", () => {
		render(<SkillsPage />);
		expect(screen.getByTestId("in-use").textContent).toBe("humanizer");
		expect(
			screen
				.getByRole("button", { name: "Researcher" })
				.getAttribute("data-enabled"),
		).toBe("true");
		expect(mocks.initializeAgent).not.toHaveBeenCalled();

		act(() => useChatStore.getState().setSelectedAgentFlowId("agent-b"));
		expect(mocks.initializeAgent).toHaveBeenCalledWith("agent-b");
		expect(screen.getByTestId("in-use").textContent).toBe("");
		const loading = screen.getByRole("button", {
			name: "Writer",
		}) as HTMLButtonElement;
		expect(loading.disabled).toBe(true);
		expect(loading.getAttribute("aria-busy")).toBe("true");
		fireEvent.click(loading);
		expect(mocks.toggleSkill).not.toHaveBeenCalled();

		act(() =>
			useAgentConfigStore.setState({
				currentFlowId: "agent-b",
				draftEnabledSkillNames: ["writer"],
			}),
		);
		expect(screen.getByTestId("in-use").textContent).toBe("writer");
		const current = screen.getByRole("button", {
			name: "Writer",
		}) as HTMLButtonElement;
		expect(current.disabled).toBe(false);
		expect(current.getAttribute("data-enabled")).toBe("false");
		fireEvent.click(current);
		expect(mocks.toggleSkill).toHaveBeenCalledWith("humanizer");
	});

	it("reloads the original agent when selected again during another agent's load", () => {
		render(<SkillsPage />);
		act(() => useChatStore.getState().setSelectedAgentFlowId("agent-b"));
		act(() => useAgentConfigStore.setState({ isLoading: true }));
		act(() => useChatStore.getState().setSelectedAgentFlowId("agent-a"));
		expect(mocks.initializeAgent).toHaveBeenLastCalledWith("agent-a");
		expect(screen.getByTestId("in-use").textContent).toBe("");
	});

	it.each([null, "chat"])(
		"clears agent assignments and disables toggling for %s",
		(id) => {
			render(<SkillsPage />);
			act(() => useChatStore.getState().setSelectedAgentFlowId(id));
			expect(screen.getByTestId("in-use").textContent).toBe("");
			expect(
				(
					screen.getByRole("button", {
						name: "detail.defaultAgentName",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true);
			expect(mocks.initializeAgent).not.toHaveBeenCalled();
		},
	);
});
