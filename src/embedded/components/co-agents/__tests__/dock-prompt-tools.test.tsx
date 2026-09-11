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

const renderDock = (overrides: Record<string, unknown> = {}) => {
	const props = {
		collapsed: false,
		showAuthAction: false,
		visibleSpeechMessage: null,
		statusLine: "",
		isSubmitting: false,
		promptOpen: true,
		inputValue: "",
		inputRef: createRef<HTMLTextAreaElement>(),
		modelAvailable: true,
		attachedAnchor: null,
		attachedSelectionLabel: null,
		agentFlows: [],
		selectedAgentFlowId: "chat",
		onSelectAgentFlow: vi.fn(),
		onDetachAnchor: vi.fn(),
		onDetachSelection: vi.fn(),
		onMessageAction: vi.fn(),
		onChangeInput: vi.fn(),
		onSubmitPrompt: vi.fn(),
		onOpenPrompt: vi.fn(),
		onClosePrompt: vi.fn(),
		onOpenConversation: vi.fn(),
		onSmartSelect: vi.fn(),
		onCanvasSelect: vi.fn(),
		isSmartSelectActive: false,
		isCanvasSelectActive: false,
		onExpand: vi.fn(),
		onSignIn: vi.fn(),
		onClose: vi.fn(),
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

/**
 * Attaching a region belongs to writing the question, so both pickers have to
 * be reachable from the compose panel and not only from the collapsed dock.
 */
describe("co-agent prompt tools", () => {
	it("offers both pickers while composing", () => {
		renderDock();

		const tools = document.querySelectorAll(".memorall-co-agent-prompt-tool");
		expect(tools).toHaveLength(2);
		for (const tool of tools) {
			// Icon-only: the name comes from the label, not visible text.
			expect(tool.textContent?.trim()).toBe("");
			expect(tool.getAttribute("aria-label")).toBeTruthy();
		}
	});

	it("starts each picker from the panel", async () => {
		const user = userEvent.setup();
		const props = renderDock();

		const [smart, canvas] = Array.from(
			document.querySelectorAll<HTMLButtonElement>(
				".memorall-co-agent-prompt-tool",
			),
		);
		await user.click(smart);
		expect(props.onSmartSelect).toHaveBeenCalledTimes(1);

		await user.click(canvas);
		expect(props.onCanvasSelect).toHaveBeenCalledTimes(1);
	});

	it("shows which picker is running", () => {
		renderDock({ isCanvasSelectActive: true });

		const active = document.querySelectorAll(
			'.memorall-co-agent-prompt-tool[data-active="true"]',
		);
		expect(active).toHaveLength(1);
		expect(active[0].getAttribute("aria-pressed")).toBe("true");
	});

	it("does not submit the prompt when a picker is clicked", () => {
		renderDock();

		for (const tool of document.querySelectorAll(
			".memorall-co-agent-prompt-tool",
		)) {
			// They sit inside the prompt <form>; a default-type button would send
			// the half-written question instead of opening the picker.
			expect(tool.getAttribute("type")).toBe("button");
		}
	});

	it("keeps the pickers out of the way when the panel is closed", () => {
		renderDock({ promptOpen: false });

		expect(
			document.querySelectorAll(".memorall-co-agent-prompt-tool"),
		).toHaveLength(0);
	});

	it("puts the pickers between the agent picker and send", () => {
		renderDock();

		const row = document.querySelector(".memorall-co-agent-prompt-tools");
		expect(row).not.toBeNull();
		expect(
			row?.querySelector(".memorall-co-agent-agent-select"),
		).not.toBeNull();
		expect(
			row?.querySelectorAll(".memorall-co-agent-prompt-tool"),
		).toHaveLength(2);
		// Send stays outside the row, in the form's second column.
		expect(row?.querySelector('button[type="submit"]')).toBeNull();
		expect(screen.getByRole("button", { name: /send/i })).toBeTruthy();
	});
});
