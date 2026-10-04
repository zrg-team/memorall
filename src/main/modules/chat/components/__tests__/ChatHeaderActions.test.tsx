import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatHeaderActions } from "../ChatHeaderActions";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ChatHeaderActions", () => {
	it("starts a new chat", async () => {
		const onNewChat = vi.fn();
		render(<ChatHeaderActions onNewChat={onNewChat} />);

		await userEvent.click(
			screen.getByRole("button", { name: "header.newChat" }),
		);
		expect(onNewChat).toHaveBeenCalledTimes(1);
	});

	it("opens the agent's computer when the agent has one", async () => {
		const onOpenComputer = vi.fn();
		render(
			<ChatHeaderActions onNewChat={vi.fn()} onOpenComputer={onOpenComputer} />,
		);

		const button = screen.getByRole("button", {
			name: "tooltips.openComputer",
		});
		expect(button.querySelector(".animate-pulse")).toBeNull();
		await userEvent.click(button);
		expect(onOpenComputer).toHaveBeenCalledTimes(1);
	});

	it("shows when the agent is working on its computer", () => {
		render(
			<ChatHeaderActions
				onNewChat={vi.fn()}
				onOpenComputer={vi.fn()}
				isComputerWorking
			/>,
		);

		const button = screen.getByRole("button", {
			name: "header.computerWorking",
		});
		expect(button.querySelector(".animate-pulse")).not.toBeNull();
	});

	it("has no computer button for agents without one", () => {
		render(<ChatHeaderActions onNewChat={vi.fn()} />);

		expect(screen.getAllByRole("button")).toHaveLength(1);
	});
});

describe("ChatHeaderActions co-agent", () => {
	const coAgent = (overrides: Record<string, unknown> = {}) => ({
		active: false,
		starting: false,
		toggle: vi.fn(),
		...overrides,
	});

	it("turns the co-agent on from the header, before the computer and new chat", async () => {
		const toggle = coAgent();
		render(
			<ChatHeaderActions
				onNewChat={vi.fn()}
				onOpenComputer={vi.fn()}
				coAgent={toggle}
			/>,
		);

		const buttons = screen.getAllByRole("button");
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
			"tooltips.startCoAgent",
			"tooltips.openComputer",
			"header.newChat",
		]);
		await userEvent.click(buttons[0] as HTMLElement);
		expect(toggle.toggle).toHaveBeenCalledTimes(1);
	});

	it("shows when it is armed, and spins while a page is being attached", () => {
		const { rerender } = render(
			<ChatHeaderActions
				onNewChat={vi.fn()}
				coAgent={coAgent({ active: true })}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "tooltips.stopCoAgent" }),
		).toHaveAttribute("aria-pressed", "true");

		rerender(
			<ChatHeaderActions
				onNewChat={vi.fn()}
				coAgent={coAgent({ starting: true })}
			/>,
		);
		const button = screen.getByRole("button", {
			name: "tooltips.startCoAgent",
		});
		expect(button).toBeDisabled();
		expect(button.querySelector(".animate-spin")).not.toBeNull();
	});

	it("is absent where no page can be driven", () => {
		render(<ChatHeaderActions onNewChat={vi.fn()} />);

		expect(
			screen.queryByRole("button", { name: "tooltips.startCoAgent" }),
		).toBeNull();
	});
});
