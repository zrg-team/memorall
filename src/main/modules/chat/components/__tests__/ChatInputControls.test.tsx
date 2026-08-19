import {
	type RenderResult,
	render as renderRaw,
	screen,
	within,
} from "@testing-library/react";
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
	it("keeps split chat on the bar at every width", () => {
		for (const isNarrow of [false, true]) {
			const { container } = render(
				<ChatInputControls {...props({ isNarrow })} />,
			);
			expect(
				within(container).getByRole("button", { name: "tooltips.splitChat" }),
			).toBeTruthy();
		}
	});

	it("shows the view controls inline when there is room", () => {
		render(<ChatInputControls {...props({ isNarrow: false })} />);

		expect(
			screen.getByRole("button", { name: "tooltips.expandChatWidth" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "tooltips.agentSettings" }),
		).toBeTruthy();
	});

	it("folds the view controls away when the composer is narrow", () => {
		render(<ChatInputControls {...props({ isNarrow: true })} />);

		expect(
			screen.queryByRole("button", { name: "tooltips.expandChatWidth" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "tooltips.agentSettings" }),
		).toBeNull();
		// The overflow menu is where they go; it is always present.
		expect(
			screen.getByRole("button", { name: "tooltips.moreActions" }),
		).toBeTruthy();
	});
});
