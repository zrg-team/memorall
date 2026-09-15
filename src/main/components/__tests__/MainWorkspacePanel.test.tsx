import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? _key,
	}),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: vi.fn(async () => null),
			set: vi.fn(async () => undefined),
		},
	},
}));

vi.mock("@/main/pages/ChatPage", () => ({
	ChatPage: () => <div data-testid="chat-page" />,
}));

vi.mock("@/main/modules/studio/components/StudioPage", async () => {
	const { createPortal } = await import("react-dom");
	const { useWorkspaceHeaderSlot } = await import(
		"@/main/components/workspace-header-slot"
	);
	return {
		StudioPage: ({ mode }: { mode: string }) => {
			const slot = useWorkspaceHeaderSlot();
			return (
				<div data-testid="studio-page" data-mode={mode}>
					{slot
						? createPortal(<button type="button">Model picker</button>, slot)
						: null}
				</div>
			);
		},
	};
});

import { MainWorkspacePanel } from "../MainWorkspacePanel";
import {
	CHAT_INSERT_TEXT_EVENT,
	useWorkspaceModeStore,
} from "@/main/stores/workspace-mode";

describe("MainWorkspacePanel", () => {
	beforeEach(() => {
		useWorkspaceModeStore.setState({
			mode: "chat",
			hydrated: true,
			pendingChatText: null,
		});
	});

	it("renders chat by default and a studio for any other mode", async () => {
		render(<MainWorkspacePanel />);
		expect(screen.getByTestId("chat-page")).toBeInTheDocument();

		fireEvent.click(
			document.querySelector(
				'[data-workspace-mode="text-to-speech"]',
			) as Element,
		);

		const studio = await screen.findByTestId("studio-page");
		expect(studio).toHaveAttribute("data-mode", "text-to-speech");
		expect(screen.queryByTestId("chat-page")).not.toBeInTheDocument();
		expect(
			document.querySelector('[data-workspace-mode="text-to-speech"]'),
		).toHaveAttribute("aria-selected", "true");
	});

	it("keeps one header: a studio's controls go beside the mode switcher", async () => {
		useWorkspaceModeStore.setState({ mode: "text-to-speech" });
		render(<MainWorkspacePanel />);

		const picker = await screen.findByRole("button", { name: "Model picker" });
		const header = document.querySelector("[data-workspace-header]");
		expect(header).toContainElement(picker);
		expect(header).toContainElement(
			document.querySelector("[data-workspace-mode-switcher]") as HTMLElement,
		);
		expect(screen.getByTestId("studio-page")).not.toContainElement(picker);
	});

	it("switches back to chat carrying text a studio sent", async () => {
		useWorkspaceModeStore.setState({ mode: "speech-to-text" });
		render(<MainWorkspacePanel />);
		await screen.findByTestId("studio-page");

		act(() => {
			window.dispatchEvent(
				new CustomEvent(CHAT_INSERT_TEXT_EVENT, {
					detail: { text: "Transcript to discuss" },
				}),
			);
		});

		await waitFor(() =>
			expect(screen.getByTestId("chat-page")).toBeInTheDocument(),
		);
		expect(useWorkspaceModeStore.getState().pendingChatText).toBe(
			"Transcript to discuss",
		);
		expect(useWorkspaceModeStore.getState().takePendingChatText()).toBe(
			"Transcript to discuss",
		);
		expect(useWorkspaceModeStore.getState().pendingChatText).toBeNull();
	});

	it("restores the last workspace from storage", async () => {
		const { platform } = await import("@/platform/current");
		vi.mocked(platform.persistentStore.get).mockResolvedValueOnce(
			"image-tools",
		);
		useWorkspaceModeStore.setState({ hydrated: false, mode: "chat" });

		render(<MainWorkspacePanel />);

		const studio = await screen.findByTestId("studio-page");
		expect(studio).toHaveAttribute("data-mode", "image-tools");
	});
});
