import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { enEmbeddedLocale } from "@/embedded/i18n/locales/en";
import { EmbeddedTranscription } from "../EmbeddedTranscription";
import type { TabTranscriptionProgress } from "@/services/tab-transcription/types";

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
const model = {
	provider: "openrouter" as const,
	serviceName: "openrouter",
	modelId: "provider/fast-chat",
};
const progress = (): TabTranscriptionProgress => ({
	session: {
		id: "meeting",
		title: "Meeting",
		tabId: 1,
		url: "https://example.com",
		status: "recording",
		startedAt: Date.now(),
		model,
		noteStyle: "none",
	},
	phase: "recording",
	capturedMs: 2500,
	savedMs: 2500,
	transcribedMs: 2500,
	totalChunks: 1,
	savedChunks: 1,
	completedChunks: 1,
	failedChunks: 0,
	pendingChunks: 0,
	chunks: [
		{
			id: "chunk",
			index: 0,
			startMs: 0,
			endMs: 2500,
			text: "Hello there.",
			status: "done",
		},
	],
});
const actions = () => ({
	stop: vi.fn(async () => {}),
	perform: vi.fn(async () => undefined),
	openStudio: vi.fn(),
	close: vi.fn(),
	configure: vi.fn(async () => {}),
	getTranslationModels: vi.fn(async () => [
		{ model, label: "OpenRouter · Fast chat" },
	]),
});

describe("live language controls", () => {
	it("lets the user choose source, target and OpenRouter model without changing settings until Apply", async () => {
		const state = progress();
		const handlers = actions();
		render(
			<EmbeddedTranscription
				state={{ session: state.session, progress: state }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Languages & translation" }),
		);
		await userEvent.selectOptions(
			screen.getByLabelText("Spoken language"),
			"en",
		);
		await userEvent.selectOptions(screen.getByLabelText("Translate to"), "vi");
		await waitFor(() =>
			expect(screen.getByLabelText("Translation model")).toBeEnabled(),
		);
		expect(
			screen.getByText(/Cloud models receive transcript text/),
		).toBeVisible();
		expect(handlers.configure).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(handlers.configure).toHaveBeenCalledWith({
			language: "en",
			translation: { targetLanguage: "vi", model, showOriginal: true },
		});
		expect(
			screen.queryByRole("region", { name: "Languages & translation" }),
		).not.toBeInTheDocument();
		expect(handlers.stop).not.toHaveBeenCalled();
	});
	it("updates streamed translation alongside original text while preserving paused reading", async () => {
		const state = progress();
		state.session.translation = { targetLanguage: "vi", model };
		state.chunks[0].translations = {
			vi: { text: "Xin", status: "pending", model },
		};
		const handlers = actions();
		const { rerender } = render(
			<EmbeddedTranscription
				state={{ session: state.session, progress: state }}
				actions={handlers}
			/>,
		);
		expect(await screen.findByText("Xin")).toBeVisible();
		expect(screen.getByText("Hello there.")).toBeVisible();
		const reader = screen.getByLabelText("Reading");
		Object.defineProperties(reader, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { value: 200 },
		});
		reader.scrollTop = 0;
		fireEvent.wheel(reader, { deltaY: -100 });
		fireEvent.scroll(reader);
		const updated = structuredClone(state);
		updated.chunks[0].translations!.vi = {
			text: "Xin chào.",
			status: "done",
			model,
		};
		rerender(
			<EmbeddedTranscription
				state={{ session: updated.session, progress: updated }}
				actions={handlers}
			/>,
		);
		expect(await screen.findByText("Xin chào.")).toBeVisible();
		expect(reader.scrollTop).toBe(0);
		expect(screen.getByText("Hello there.")).toBeVisible();
	});
	it("supports translation-only reading, turning translation off, and closing without an action", async () => {
		const state = progress();
		state.session.translation = {
			targetLanguage: "vi",
			model,
			showOriginal: false,
		};
		state.chunks[0].translations = {
			vi: { text: "Xin chào.", status: "done", model },
		};
		const handlers = actions();
		render(
			<EmbeddedTranscription
				state={{ session: state.session, progress: state }}
				actions={handlers}
			/>,
		);
		expect(await screen.findByText("Xin chào.")).toBeVisible();
		expect(screen.queryByText("Hello there.")).not.toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Languages & translation" }),
		);
		await userEvent.selectOptions(screen.getByLabelText("Translate to"), "off");
		await userEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(handlers.configure).toHaveBeenCalledWith({
			language: null,
			translation: null,
		});
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(handlers.stop).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
	});
	it("keeps unapplied choices out of the session when the language form is cancelled", async () => {
		const state = progress();
		const handlers = actions();
		render(
			<EmbeddedTranscription
				state={{ session: state.session, progress: state }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Languages & translation" }),
		);
		await userEvent.selectOptions(screen.getByLabelText("Translate to"), "ar");
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(handlers.configure).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
	});
});
