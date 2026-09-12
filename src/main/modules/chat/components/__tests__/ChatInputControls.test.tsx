import {
	type RenderResult,
	render as renderRaw,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import { ChatInputControls } from "../input/ChatInputControls";

/** The composer wraps the toolbar in a provider; the controls assume it. */
const render = (ui: ReactElement): RenderResult =>
	renderRaw(<TooltipProvider>{ui}</TooltipProvider>);

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/AgentIcon", () => ({
	AgentIcon: () => <div data-testid="agent-icon" />,
	toAgentScreenContent: () => undefined,
}));

const props = (overrides: Record<string, unknown> = {}) => ({
	isLoading: false,
	model: "test-model",
	status: "ready" as const,
	selectedTopic: "default",
	setSelectedTopic: vi.fn(),
	onInsertSeparator: vi.fn(),
	onStop: vi.fn(),
	abortController: null,
	isLoadingTopics: false,
	topics: [{ id: "topic-1", name: "Research notes", agentId: "agent-1" }],
	agentFlows: [{ id: "agent-1", name: "Batdongsan HCM Property Researcher" }],
	selectedAgentFlowId: "agent-1",
	setSelectedAgentFlowId: vi.fn(),
	onCreateAgentFlow: vi.fn(),
	onDeleteChat: vi.fn(),
	onOpenAgentSettings: vi.fn(),
	isCustomMode: true,
	onAttachFileClick: vi.fn(),
	onAttachDocumentClick: vi.fn(),
	canSubmit: true,
	isFullWidth: false,
	onToggleFullWidth: vi.fn(),
	...overrides,
});

/** The bar is a single flex row; nothing may opt back into wrapping. */
const toolbarRow = (container: HTMLElement) =>
	container.querySelector<HTMLElement>(".flex.min-w-0.flex-1.items-center");

describe("ChatInputControls layout", () => {
	it("lays the toolbar out on one row that never wraps", () => {
		const { container } = render(<ChatInputControls {...props()} />);

		const row = toolbarRow(container);
		expect(row).not.toBeNull();
		expect(row?.className).not.toContain("flex-wrap");
		expect(container.querySelectorAll('[class*="flex-wrap"]')).toHaveLength(0);
	});

	it("keeps agent and memory in one chip with two triggers", () => {
		const { container } = render(<ChatInputControls {...props()} />);

		// Both selectors live in the same rounded container, not as two chips.
		const chip = container.querySelector<HTMLElement>(
			".flex.h-8.min-w-0.items-center.rounded-xl",
		);
		expect(chip).not.toBeNull();
		expect(within(chip as HTMLElement).getAllByRole("button")).toHaveLength(2);
	});

	it("drops the memory half outside agent mode", () => {
		const { container } = render(
			<ChatInputControls
				{...props({ isCustomMode: false, selectedAgentFlowId: "chat" })}
			/>,
		);

		const chip = container.querySelector<HTMLElement>(
			".flex.h-8.min-w-0.items-center.rounded-xl",
		);
		expect(within(chip as HTMLElement).getAllByRole("button")).toHaveLength(1);
	});

	it("gives every control the same 32px box", () => {
		const { container } = render(<ChatInputControls {...props()} />);

		for (const button of container.querySelectorAll("button")) {
			expect(button.className).toMatch(/\bh-8\b/);
		}
	});

	it("keeps the stop button the same size as submit", () => {
		const { container: idle } = render(<ChatInputControls {...props()} />);
		const submit = idle.querySelector("[data-chat-submit]");
		expect(submit?.className).toContain("h-8");
		expect(submit?.className).toContain("w-8");

		const { container: busy } = render(
			<ChatInputControls
				{...props({
					isLoading: true,
					abortController: new AbortController(),
				})}
			/>,
		);
		const stop = within(busy).getByRole("button", {
			name: "tooltips.stopGeneration",
		});
		expect(stop.className).toContain("h-8");
		expect(stop.className).toContain("w-8");
	});

	it("keeps exactly one submit target for the e2e locator", () => {
		const { container } = render(<ChatInputControls {...props()} />);
		expect(container.querySelectorAll("[data-chat-submit]")).toHaveLength(1);
	});
});

describe("ChatInputControls folding", () => {
	it("shows every right-hand control inline when there is room", () => {
		render(<ChatInputControls {...props({ isNarrow: false })} />);

		expect(
			screen.getByRole("button", { name: "tooltips.splitChat" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "tooltips.expandChatWidth" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "tooltips.agentSettings" }),
		).toBeTruthy();
	});

	it("drops the overflow trigger when every action is already on the bar", () => {
		// With room for the real buttons the menu held nothing the toolbar was
		// not already showing, so it was one more control to read past.
		render(<ChatInputControls {...props({ isNarrow: false })} />);

		expect(
			screen.queryByRole("button", { name: "tooltips.moreActions" }),
		).toBeNull();
	});

	it("folds every right-hand control into the overflow menu when narrow", () => {
		// At small widths the bar cannot show them all, so the row keeps only the
		// overflow trigger and submit and the rest move under "...".
		render(<ChatInputControls {...props({ isNarrow: true })} />);

		expect(
			screen.queryByRole("button", { name: "tooltips.splitChat" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "tooltips.expandChatWidth" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "tooltips.agentSettings" }),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "tooltips.moreActions" }),
		).toBeTruthy();
	});
});

describe("ChatInputControls co-agent", () => {
	it("offers the co-agent beside attach when the surface supports it", async () => {
		const onStartCoAgent = vi.fn();
		const { container } = render(
			<ChatInputControls {...props({ onStartCoAgent })} />,
		);

		const button = within(container).getByRole("button", {
			name: "tooltips.startCoAgent",
		});
		await userEvent.click(button);
		expect(onStartCoAgent).toHaveBeenCalledTimes(1);
	});

	it("sits immediately after the attach control", () => {
		const { container } = render(
			<ChatInputControls {...props({ onStartCoAgent: vi.fn() })} />,
		);

		const tools = container.querySelectorAll('[class*="flex-nowrap"] > *');
		// Attach dropdown, then the co-agent button, then the agent/memory chip.
		expect(tools.length).toBeGreaterThanOrEqual(3);
		expect(tools[1]?.textContent ?? "").toBe("");
		expect((tools[1] as HTMLElement).querySelector(".animate-spin")).toBeNull();
	});

	it("omits the button entirely where no browser tab can be driven", () => {
		const { container } = render(<ChatInputControls {...props()} />);

		expect(
			within(container).queryByRole("button", {
				name: "tooltips.startCoAgent",
			}),
		).toBeNull();
	});

	it("disables and spins while a tab is being opened", () => {
		const { container } = render(
			<ChatInputControls
				{...props({ onStartCoAgent: vi.fn(), isCoAgentStarting: true })}
			/>,
		);

		const button = within(container).getByRole("button", {
			name: "tooltips.startCoAgent",
		});
		expect(button).toBeDisabled();
		expect(button.querySelector(".animate-spin")).not.toBeNull();
	});
});

describe("ChatInputControls model selector", () => {
	const MODELS = [
		{
			id: "gpt-4o-mini",
			name: "gpt-4o-mini",
			provider: "openai" as const,
			serviceName: "openai",
			isLocal: false,
			loaded: true,
		},
	];
	const modelProps = (overrides: Record<string, unknown> = {}) =>
		props({
			model: "gpt-4o-mini",
			selectableModels: MODELS,
			selectableModelsByProvider: new Map([["openai" as const, MODELS]]),
			onSelectModel: vi.fn(),
			...overrides,
		});

	it("sits to the right of the agent chip", () => {
		const { container } = render(<ChatInputControls {...modelProps()} />);

		const tools = container.querySelectorAll('[class*="flex-nowrap"] > *');
		const pills = Array.from(tools).filter((node) =>
			node.className.includes("rounded-xl bg-muted/40"),
		);
		// The agent/memory pill first, then the model's own pill.
		expect(pills).toHaveLength(2);
		expect(pills[1]?.textContent).toContain("gpt-4o-mini");
	});

	it("stays out of the way until a surface can switch models", () => {
		const { container } = render(<ChatInputControls {...props()} />);

		expect(container.textContent).not.toContain("gpt-4o-mini");
	});

	it("keeps a readable short name at narrow widths", () => {
		const { container } = render(
			<ChatInputControls {...modelProps({ isNarrow: true })} />,
		);

		// Shortened, not hidden: the bar must still say which model is running.
		expect(container.textContent).toContain("gpt-4o-mini");
		expect(container.querySelector(".max-w-14")).not.toBeNull();
	});
});
