import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";
import { TranscriptionStudio } from "../TranscriptionStudio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? _key,
	}),
}));

const service = vi.hoisted(() => ({
	saveStudioInput: vi.fn(),
	transcribeAudio: vi.fn(),
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));
vi.mock("../../../services/studio-service", () => service);

vi.mock("../../../hooks/use-audio-recorder", () => ({
	useAudioRecorder: () => ({
		state: "idle",
		level: 0,
		elapsedMs: 0,
		start: vi.fn(),
		stop: vi.fn(async () => null),
		cancel: vi.fn(),
	}),
}));

vi.mock("../../../hooks/use-media-url", () => ({
	useMediaUrl: () => ({ url: "blob:clip", error: null }),
}));

const store = vi.hoisted(() => ({ deleteItem: vi.fn(), updateItem: vi.fn() }));
vi.mock("@/main/stores/studio", () => ({
	useStudioStore: { getState: () => store },
}));

vi.mock("@/main/stores/workspace-mode", () => ({
	useWorkspaceModeStore: { getState: () => ({ setMode: vi.fn() }) },
}));

const ASR: CurrentModelInfo = {
	modelId: "org/asr-model",
	provider: "transformer-media",
	serviceName: "transformer-media",
};

/** What a model reports about itself; only declared languages matter here. */
const infoWithLanguages = (languages: string[]) => ({
	id: ASR.modelId,
	object: "model" as const,
	created: 0,
	owned_by: "transformer-media",
	loaded: false,
	languages,
});

const renderUI = (ui: ReactElement) =>
	render(<TooltipProvider>{ui}</TooltipProvider>);

const transcriptItem = (overrides: Partial<StudioItem> = {}): StudioItem => ({
	id: "item-1",
	conversationId: "c1",
	category: "speech-to-text",
	content: "Hello there. General Kenobi.",
	parts: [
		{
			type: "input_audio",
			input_audio: {
				path: "recordings/talk.webm",
				mimeType: "audio/webm",
				durationMs: 20_000,
				name: "talk.webm",
			},
		},
		{ type: "text", role: "transcript", text: "Hello there. General Kenobi." },
		{
			type: "segments",
			language: "en",
			segments: [
				{ id: 0, start: 0, end: 4, text: " Hello there." },
				{ id: 1, start: 12.4, end: 15, text: " General Kenobi." },
			],
		},
	],
	generation: {
		category: "speech-to-text",
		provider: "transformer-media",
		serviceName: "transformer-media",
		modelId: ASR.modelId,
		status: "done",
		params: { language: "en", task: "transcribe" },
	},
	createdAt: new Date("2026-09-01T10:00:00Z"),
	...overrides,
});

const props = (
	overrides: Partial<Parameters<typeof TranscriptionStudio>[0]> = {},
) => ({
	mode: "speech-to-text" as const,
	model: ASR,
	items: [] as StudioItem[],
	ensureModelReady: vi.fn(async () => ASR),
	isNarrow: true,
	...overrides,
});

const fileInput = () => {
	const input = document.querySelector<HTMLInputElement>(
		"[data-transcription-file-input]",
	);
	if (!input) throw new Error("No file input rendered.");
	return input;
};

describe("TranscriptionStudio", () => {
	beforeEach(() => {
		service.saveStudioInput.mockReset();
		service.transcribeAudio.mockReset();
		store.deleteItem.mockReset();
	});

	it("stores an upload, then transcribes it with the chosen language and task once the model is ready", async () => {
		const stored = {
			kind: "file",
			path: "recordings/x.mp3",
			mimeType: "audio/mpeg",
		};
		service.saveStudioInput.mockResolvedValue(stored);
		service.transcribeAudio.mockImplementation(async (options) => {
			options.onDelta?.("Xin chào");
			return transcriptItem();
		});
		const ensureModelReady = vi.fn(async () => ASR);
		const canvas = props({ ensureModelReady });
		const user = userEvent.setup();
		renderUI(<TranscriptionStudio {...canvas} />);

		await user.selectOptions(
			document.querySelector(
				"[data-transcription-language]",
			) as HTMLSelectElement,
			"vi",
		);
		await user.click(
			document.querySelector(
				"[data-task-option='translate']",
			) as HTMLButtonElement,
		);
		const file = new File(["audio-bytes"], "interview.mp3", {
			type: "audio/mpeg",
		});
		await user.upload(fileInput(), file);

		await waitFor(() =>
			expect(service.transcribeAudio).toHaveBeenCalledTimes(1),
		);
		expect(service.saveStudioInput).toHaveBeenCalledWith(file, "audio");
		expect(service.transcribeAudio).toHaveBeenCalledWith(
			expect.objectContaining({
				model: ASR,
				file: stored,
				fileName: "interview.mp3",
				language: "vi",
				task: "translate",
				signal: expect.any(AbortSignal),
			}),
		);
		const ready = ensureModelReady.mock.invocationCallOrder[0]!;
		expect(ready).toBeLessThan(
			service.saveStudioInput.mock.invocationCallOrder[0]!,
		);
		expect(service.saveStudioInput.mock.invocationCallOrder[0]!).toBeLessThan(
			service.transcribeAudio.mock.invocationCallOrder[0]!,
		);
	});

	it("refuses files over 100 MB without storing them", async () => {
		const user = userEvent.setup();
		renderUI(<TranscriptionStudio {...props()} />);
		const file = new File(["x"], "huge.wav", { type: "audio/wav" });
		Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });
		await user.upload(fileInput(), file);

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("huge.wav");
		expect(service.saveStudioInput).not.toHaveBeenCalled();
	});

	it("renders timestamped segments for a finished transcript", () => {
		renderUI(<TranscriptionStudio {...props({ items: [transcriptItem()] })} />);

		const rows = document.querySelectorAll("[data-segment-seek]");
		expect(rows).toHaveLength(2);
		expect(screen.getByText("[00:00]")).toBeTruthy();
		expect(screen.getByText("[00:12]")).toBeTruthy();
		expect(screen.getByText("General Kenobi.")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Play from 00:12" }),
		).toBeTruthy();
		expect(
			document.querySelector("[data-transcript-language]")?.textContent,
		).toBe("EN");
	});

	it("hides language and translation options for a model that declares English only", () => {
		renderUI(
			<TranscriptionStudio
				{...props({ modelInfo: infoWithLanguages(["en"]) })}
			/>,
		);

		expect(document.querySelector("[data-task-option]")).toBeNull();
		expect(document.querySelector("[data-transcription-language]")).toBeNull();
		expect(
			screen.getByText("This model understands English only."),
		).toBeTruthy();
	});

	it("offers language and translation for a model that does not declare languages", () => {
		renderUI(<TranscriptionStudio {...props()} />);

		expect(
			document.querySelector("[data-transcription-language]"),
		).toBeTruthy();
		expect(document.querySelector("[data-task-option]")).toBeTruthy();
	});

	it("offers Retry on a failed transcript and re-runs the same clip and options", async () => {
		service.transcribeAudio.mockResolvedValue(transcriptItem());
		const failed = transcriptItem({
			id: "failed-1",
			parts: [transcriptItem().parts[0]!],
			generation: {
				...transcriptItem().generation,
				status: "failed",
				error: "Decoder crashed",
				params: { language: "vi", task: "translate" },
			},
		});
		const canvas = props({ items: [failed] });
		const user = userEvent.setup();
		renderUI(<TranscriptionStudio {...canvas} />);

		expect(screen.getByText("Decoder crashed")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() =>
			expect(service.transcribeAudio).toHaveBeenCalledTimes(1),
		);
		expect(canvas.ensureModelReady).toHaveBeenCalled();
		expect(service.saveStudioInput).not.toHaveBeenCalled();
		expect(service.transcribeAudio).toHaveBeenCalledWith(
			expect.objectContaining({
				file: {
					kind: "file",
					path: "recordings/talk.webm",
					mimeType: "audio/webm",
				},
				fileName: "talk.webm",
				language: "vi",
				task: "translate",
			}),
		);
		// The failed attempt is replaced rather than left beside the new one.
		expect(store.deleteItem).toHaveBeenCalledWith("speech-to-text", "failed-1");
	});
});
