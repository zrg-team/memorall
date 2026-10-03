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
