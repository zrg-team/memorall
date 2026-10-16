import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { CoAgentDock } from "../CoAgentDock";

vi.mock("@/embedded/components/messages/AssistantMessageContent", () => ({
	AssistantMessageContent: () => <div data-testid="assistant-content" />,
}));

vi.mock("@/components/AgentIcon", () => ({
	AgentIcon: () => <div data-testid="agent-icon" />,
}));

const AGENT_FLOWS = [
	{ id: "chat", name: "CoAgent" },
	{ id: "agent-hf", name: "HF Papers Daily Ranking" },
	{ id: "agent-vi", name: "Vietnamese tutor" },
];

const renderDock = (overrides: Record<string, unknown> = {}) => {
	const props = {
		collapsed: false,
		showAuthAction: false,
		visibleSpeechMessage: "",
		statusLine: "",
		isSubmitting: false,
		promptOpen: false,
		inputValue: "",
		inputRef: createRef<HTMLTextAreaElement>(),
		modelAvailable: true,
		attachedAnchor: null,
		attachedSelectionLabel: null,
		agentFlows: AGENT_FLOWS,
		selectedAgentFlowId: "agent-hf",
		onSelectAgentFlow: vi.fn(),
		onDetachAnchor: vi.fn(),
		onDetachSelection: vi.fn(),
		onMessageAction: vi.fn(),
		onChangeInput: vi.fn(),
		onSubmitPrompt: vi.fn(),
		onOpenPrompt: vi.fn(),
		onClosePrompt: vi.fn(),
		onOpenConversation: vi.fn(),
		onUnlock: vi.fn(),
		onLeaveCoAgent: vi.fn(),
		onSmartSelect: vi.fn(),
		onCanvasSelect: vi.fn(),
		onExpand: vi.fn(),
		onDismissBubble: vi.fn(),
		...overrides,
	};
	render(
		<CoAgentDock
			{...(props as unknown as ComponentProps<typeof CoAgentDock>)}
		/>,
	);
	return props;
};

const tag = () => document.querySelector(".memorall-co-agent-agent-tag");

/** The user has to see which agent they are working with, and switch it there. */
describe("co-agent name tag", () => {
	it("names the agent being worked with, composer open or not", () => {
		renderDock();

		expect(tag()?.textContent).toContain("HF Papers Daily Ranking");
		expect(screen.getByRole("combobox", { name: /select agent/i })).toBe(
			tag()?.querySelector("select"),
		);
	});

	it("switches the agent from the tag", async () => {
		const user = userEvent.setup();
		const props = renderDock();

		await user.selectOptions(
			screen.getByRole("combobox", { name: /select agent/i }),
			"agent-vi",
		);

		expect(props.onSelectAgentFlow).toHaveBeenCalledWith("agent-vi");
	});

	it("offers every agent once", () => {
		renderDock();

		const values = Array.from(
			tag()?.querySelectorAll("option") ?? [],
			(option) => option.value,
		);
		expect(values).toEqual(["chat", "agent-hf", "agent-vi"]);
	});

	it("names the built-in agent before the list has loaded", () => {
		renderDock({ agentFlows: [], selectedAgentFlowId: "chat" });

		expect(tag()?.textContent).toContain("CoAgent");
	});

	it("waits for the list rather than guess a saved agent's name", () => {
		renderDock({ agentFlows: [], selectedAgentFlowId: "agent-hf" });

		expect(tag()).toBeNull();
	});

	it("cannot switch agents mid-run", () => {
		renderDock({ isSubmitting: true });

		expect(tag()?.querySelector("select")?.disabled).toBe(true);
	});

	it("stays out of the collapsed dock", () => {
		renderDock({ collapsed: true });
		expect(tag()).toBeNull();
	});

	it("stays out of the unlock prompt", () => {
		renderDock({ showAuthAction: true });
		expect(tag()).toBeNull();
	});
});
