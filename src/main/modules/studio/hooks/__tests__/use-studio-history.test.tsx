import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { useStudioHistory } from "../use-studio-history";

const store = vi.hoisted(() => ({
	loadMode: vi.fn(),
	openConversation: vi.fn(),
}));
vi.mock("@/main/stores/studio", () => ({
	useStudioStore: (select: (state: typeof store) => unknown) => select(store),
}));

function Page({ mode }: { mode: MediaCategory }) {
	useStudioHistory(mode);
	return <output data-testid="search">{useLocation().search}</output>;
}

beforeEach(() => {
	vi.resetAllMocks();
	store.loadMode.mockResolvedValue(undefined);
	store.openConversation.mockResolvedValue(undefined);
});

describe("recording thread links", () => {
	it("waits for history, selects the linked recording, then consumes only the transcript query", async () => {
		let ready!: () => void;
		store.loadMode.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					ready = resolve;
				}),
		);
		render(
			<MemoryRouter initialEntries={["/?transcript=recording-id&keep=value"]}>
				<Page mode="speech-to-text" />
			</MemoryRouter>,
		);
		expect(store.openConversation).not.toHaveBeenCalled();
		await act(async () => ready());
		await waitFor(() =>
			expect(store.openConversation).toHaveBeenCalledWith(
				"speech-to-text",
				"recording-id",
			),
		);
		expect(screen.getByTestId("search")).toHaveTextContent("?keep=value");
		expect(store.openConversation).toHaveBeenCalledOnce();
	});
	it("does not select a recording in another studio", async () => {
		render(
			<MemoryRouter initialEntries={["/?transcript=recording-id"]}>
				<Page mode="text-to-speech" />
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(store.loadMode).toHaveBeenCalledWith("text-to-speech"),
		);
		expect(store.openConversation).not.toHaveBeenCalled();
	});
	it("does not reopen a thread after its page was unmounted during history loading", async () => {
		let ready!: () => void;
		store.loadMode.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					ready = resolve;
				}),
		);
		const { unmount } = render(
			<MemoryRouter initialEntries={["/?transcript=recording-id"]}>
				<Page mode="speech-to-text" />
			</MemoryRouter>,
		);
		unmount();
		await act(async () => ready());
		expect(store.openConversation).not.toHaveBeenCalled();
	});
});
