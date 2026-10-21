import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enEmbeddedLocale } from "@/embedded/i18n/locales/en";
import { TabTranscriptionPanel } from "../TabTranscriptionPanel";
import type {
	TabTranscriptionCommand,
	TabTranscriptionSession,
} from "@/services/tab-transcription/types";
const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	supported: vi.fn(),
	chat: vi.fn(),
}));
vi.mock("@/services/tab-transcription/client", () => ({
	requestTabTranscription: mocks.request,
	supportsTabTranscription: mocks.supported,
}));
vi.mock("@/main/stores/workspace-mode", () => ({
	useWorkspaceModeStore: { getState: () => ({ sendTextToChat: mocks.chat }) },
}));
vi.mock("@/embedded/hooks/use-embedded-language", () => ({
	useEmbeddedTranslation:
		() =>
		(
			key: keyof typeof enEmbeddedLocale.transcription,
			values: Record<string, unknown> = {},
		) =>
			enEmbeddedLocale.transcription[key].replace(/\{(\w+)\}/g, (_, name) =>
				String(values[name] ?? name),
			),
}));
const session: TabTranscriptionSession = {
	id: "session",
	title: "Team meeting",
	url: "https://meet.example/",
	tabId: 7,
	startedAt: Date.now(),
	status: "complete",
	model: {
		provider: "transformer-media",
		serviceName: "transformer-media",
		modelId: "asr",
	},
	noteStyle: "none",
};
describe("transcript threads", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.supported.mockReturnValue(true);
		mocks.request.mockImplementation(
			async (command: TabTranscriptionCommand) => {
				if (command.action === "list")
					return { success: true, sessions: [session] };
				if (command.action === "get")
					return {
						success: true,
						transcript: {
							session,
							chunks: [
								{
									id: "c",
									index: 0,
									startMs: 0,
									endMs: 5000,
									audioPath: "a.wav",
									status: "done",
									text: "The project is ready.",
								},
							],
						},
					};
				if (command.action === "finish-action")
					return {
						success: true,
						path: "/transcripts/meeting.md",
						export: {
							content: "Full saved transcript",
							fileName: "meeting.md",
							mimeType: "text/markdown",
						},
					};
				return { success: true, session: null };
			},
		);
	});
	it("puts readable text first and defers summary and file controls to Next steps", async () => {
		render(<TabTranscriptionPanel sessionId="session" />);
		expect(await screen.findByText("The project is ready.")).toBeVisible();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
		expect(screen.queryByText(/Captures audio played/)).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: /Create a summary/ }),
		);
		await waitFor(() =>
			expect(mocks.request).toHaveBeenCalledWith({
				action: "summarize",
				sessionId: "session",
				noteStyle: "summary",
			}),
		);
	});
	it("writes a file and sends the complete recording to the chat composer", async () => {
		render(<TabTranscriptionPanel sessionId="session" />);
		await screen.findByText("The project is ready.");
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Save to Files" }),
		);
		expect(
			await screen.findByText("Saved to /transcripts/meeting.md"),
		).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Send to chat" }),
		);
		expect(mocks.chat).toHaveBeenCalledWith("Full saved transcript");
	});
	it("keeps Stop session visible while the saved row is stale and does not trigger automatic notes", async () => {
		const original = mocks.request.getMockImplementation()!;
		mocks.request.mockImplementation(
			async (command: TabTranscriptionCommand) =>
				command.action === "status"
					? { success: true, session: { ...session, status: "recording" } }
					: original(command),
		);
		render(<TabTranscriptionPanel sessionId="session" />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Stop recording" }),
		);
		expect(mocks.request).toHaveBeenCalledWith({
			action: "stop",
			tabId: 7,
			noteStyle: "none",
		});
		expect(
			mocks.request.mock.calls.some(
				([command]) => command.action === "summarize",
			),
		).toBe(false);
	});
	it("hides itself for ordinary threads and outside extension environments", () => {
		const { container, rerender } = render(
			<TabTranscriptionPanel sessionId={null} />,
		);
		expect(container).toBeEmptyDOMElement();
		mocks.supported.mockReturnValue(false);
		rerender(<TabTranscriptionPanel sessionId="session" />);
		expect(container).toBeEmptyDOMElement();
	});
});
