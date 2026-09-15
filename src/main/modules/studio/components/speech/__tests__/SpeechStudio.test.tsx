import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";
import { SpeechStudio } from "../SpeechStudio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

const { generateSpeech, deleteItem } = vi.hoisted(() => ({
	generateSpeech: vi.fn(),
	deleteItem: vi.fn(),
}));

vi.mock("@/main/modules/studio/services/studio-service", () => ({
	generateSpeech,
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));

vi.mock("@/main/modules/studio/hooks/use-pcm-stream-player", () => ({
	usePcmStreamPlayer: () => ({
		enqueue: vi.fn(),
		stop: vi.fn(),
		playing: false,
		analyser: null,
	}),
}));

vi.mock("@/main/stores/studio", () => ({
	useStudioStore: (
		selector: (store: { deleteItem: typeof deleteItem }) => unknown,
	) => selector({ deleteItem }),
}));

// Media URLs need the documents filesystem; the card only has to place a player.
vi.mock("@/main/modules/studio/components/shared/AudioClipPlayer", () => ({
	AudioClipPlayer: ({ path }: { path: string }) => (
		<div data-testid="audio-player" data-path={path} />
	),
}));

/** A hosted model that publishes no voices: the voice is typed. */
const HOSTED: CurrentModelInfo = {
	modelId: "any-speech-model",
	provider: "openai",
	serviceName: "openai",
};

/** A local model whose repo ships speaker embeddings. */
const LOCAL: CurrentModelInfo = {
	modelId: "org/speech-model",
	provider: "transformer-media",
	serviceName: "transformer-media",
};

const LOCAL_INFO = {
	id: LOCAL.modelId,
	object: "model" as const,
	created: 0,
	owned_by: "transformer-media",
	loaded: false,
	voices: [
		{
			id: "voices/anna.bin",
			name: "anna",
			path: "https://hub.test/voices/anna.bin",
		},
		{
			id: "voices/ben.bin",
			name: "ben",
			path: "https://hub.test/voices/ben.bin",
		},
	],
};

const AUDIO: CurrentModelInfo = {
	modelId: "org/audio-model",
	provider: "transformer-media",
	serviceName: "transformer-media",
};

const item = (overrides: Partial<StudioItem> & { id: string }): StudioItem => ({
	conversationId: "session-1",
	category: "text-to-speech",
	content: "Hello there",
	parts: [{ type: "text", text: "Hello there", role: "prompt" }],
	generation: {
		category: "text-to-speech",
		provider: "openai",
		serviceName: "openai",
		modelId: "any-speech-model",
		status: "done",
		params: { voice: "nova", speed: 1.25 },
	},
	createdAt: new Date("2026-09-15T10:00:00Z"),
	...overrides,
});

const renderUI = (ui: ReactElement) =>
	render(<TooltipProvider>{ui}</TooltipProvider>);

const setup = ({
	mode = "text-to-speech",
	model = HOSTED,
	modelInfo,
	items = [],
	isNarrow = false,
}: {
	mode?: "text-to-speech" | "text-to-audio";
	model?: CurrentModelInfo;
	modelInfo?: typeof LOCAL_INFO;
	items?: StudioItem[];
	isNarrow?: boolean;
} = {}) => {
	const ensureModelReady = vi.fn(async () => model);
	const user = userEvent.setup();
	renderUI(
		<SpeechStudio
			mode={mode}
			model={model}
			modelInfo={modelInfo}
			items={items}
			ensureModelReady={ensureModelReady}
			isNarrow={isNarrow}
		/>,
	);
	return { ensureModelReady, user };
};

const input = () =>
	document.querySelector<HTMLTextAreaElement>("[data-speech-input]")!;
const voiceInput = () =>
	document.querySelector<HTMLInputElement>("[data-speech-voice-input]")!;
const generateButton = () =>
	document.querySelector<HTMLButtonElement>("[data-speech-generate]")!;

describe("SpeechStudio", () => {
	beforeEach(() => {
		generateSpeech.mockReset();
		generateSpeech.mockResolvedValue(undefined);
		deleteItem.mockReset();
		window.localStorage.clear();
	});

	it("keeps Generate disabled until there is text and a voice", async () => {
		const { user } = setup();
		expect(generateButton()).toBeDisabled();

		await user.type(input(), "   ");
		expect(generateButton()).toBeDisabled();

		await user.type(input(), "Hi");
		expect(generateButton()).toBeDisabled();

		await user.type(voiceInput(), "any-voice");
		expect(generateButton()).toBeEnabled();
	});

	it("loads the model first, then generates with the chosen voice and speed", async () => {
		const { ensureModelReady, user } = setup({
			model: LOCAL,
			modelInfo: LOCAL_INFO,
		});
		await user.type(input(), "Read this aloud");
		await user.click(generateButton());

		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
		expect(ensureModelReady).toHaveBeenCalledTimes(1);
		expect(ensureModelReady.mock.invocationCallOrder[0]).toBeLessThan(
			generateSpeech.mock.invocationCallOrder[0]!,
		);
		expect(generateSpeech).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "text-to-speech",
				model: LOCAL,
				input: "Read this aloud",
				voice: "voices/anna.bin",
				speed: 1,
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("generates with a single-speaker local model without asking for a voice", async () => {
		const { user } = setup({
			model: LOCAL,
			modelInfo: { ...LOCAL_INFO, voices: [] },
		});
		expect(voiceInput()).toBeNull();

		await user.type(input(), "One speaker");
		expect(generateButton()).toBeEnabled();
		await user.click(generateButton());

		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
		expect(generateSpeech.mock.calls[0]![0]).toMatchObject({
			input: "One speaker",
			voice: "default",
		});
	});

	it("generates on Enter, like chat", async () => {
		const { user } = setup();
		await user.type(voiceInput(), "any-voice");
		await user.type(input(), "Keyboard person{Enter}");

		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
		expect(generateSpeech.mock.calls[0]![0]).toMatchObject({
			input: "Keyboard person",
		});
	});

	it("still generates on Ctrl+Enter", async () => {
		const { user } = setup();
		await user.type(voiceInput(), "any-voice");
		await user.type(input(), "Keyboard person");
		await user.keyboard("{Control>}{Enter}{/Control}");

		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
	});

	it("keeps a newline on Shift+Enter without generating", async () => {
		const { user } = setup();
		await user.type(voiceInput(), "any-voice");
		await user.type(input(), "Line one{Shift>}{Enter}{/Shift}Line two");
		expect(generateSpeech).not.toHaveBeenCalled();
		expect(input().value).toBe("Line one\nLine two");
	});

	it("shows Stop while running and aborts on click", async () => {
		let signal: AbortSignal | undefined;
		generateSpeech.mockImplementation(
			(options: { signal: AbortSignal }) =>
				new Promise((_, reject) => {
					signal = options.signal;
					options.signal.addEventListener("abort", () => {
						const error = new Error("aborted");
						error.name = "AbortError";
						reject(error);
					});
				}),
		);
		const { user } = setup();
		await user.type(voiceInput(), "any-voice");
		await user.type(input(), "Long text");
		await user.click(generateButton());

		const stop = await waitFor(() => {
			const button =
				document.querySelector<HTMLButtonElement>("[data-speech-stop]");
			if (!button) throw new Error("no stop button yet");
			return button;
		});
		await user.click(stop);

		expect(signal?.aborted).toBe(true);
		await waitFor(() => expect(generateButton()).toBeTruthy());
		expect(document.querySelector("[data-speech-announcer]")?.textContent).toBe(
			"Generation stopped",
		);
	});

	it("renders a player for a finished clip with its voice", () => {
		setup({
			items: [
				item({
					id: "done-1",
					parts: [
						{ type: "text", text: "Hello there", role: "prompt" },
						{
							type: "output_audio",
							output_audio: {
								path: "generated/clip.wav",
								mimeType: "audio/wav",
								durationMs: 1200,
								voice: "nova",
							},
						},
					],
				}),
			],
		});

		expect(screen.getByTestId("audio-player")).toHaveAttribute(
			"data-path",
			"generated/clip.wav",
		);
		// The voice id as stored; file-path ids show their readable tail.
		expect(
			document.querySelector("[data-speech-clip-voice]")?.textContent,
		).toBe("nova");
		expect(document.querySelector("[data-workspace-empty]")).toBeNull();
	});

	it("shows the error on a failed clip and retries with its settings", async () => {
		const { user } = setup({
			items: [
				item({
					id: "failed-1",
					generation: {
						category: "text-to-speech",
						provider: "openai",
						serviceName: "openai",
						modelId: "any-speech-model",
						status: "failed",
						error: "Rate limit reached",
						params: { voice: "nova", speed: 1.25 },
					},
				}),
			],
		});

		expect(screen.getByText("Rate limit reached")).toBeTruthy();
		expect(screen.queryByTestId("audio-player")).toBeNull();

		await user.click(
			document.querySelector<HTMLButtonElement>("[data-speech-clip-retry]")!,
		);
		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
		expect(generateSpeech.mock.calls[0]![0]).toMatchObject({
			input: "Hello there",
			voice: "nova",
			speed: 1.25,
		});
	});

	it("puts a clip's text back into the composer on Reuse", async () => {
		const { user } = setup({ items: [item({ id: "done-2" })] });
		await user.click(
			document.querySelector<HTMLButtonElement>("[data-speech-clip-reuse]")!,
		);
		expect(input().value).toBe("Hello there");
		expect(voiceInput().value).toBe("nova");
	});

	it("deletes a clip from its footer", async () => {
		const { user } = setup({ items: [item({ id: "done-3" })] });
		await user.click(
			document.querySelector<HTMLButtonElement>("[data-speech-clip-delete]")!,
		);
		expect(deleteItem).toHaveBeenCalledWith("text-to-speech", "done-3");
	});

	it("offers the voices a model ships and English examples when it speaks English", async () => {
		const { user } = setup({
			model: LOCAL,
			modelInfo: {
				...LOCAL_INFO,
				languages: ["en", "fr"],
			} as typeof LOCAL_INFO,
		});
		const examples = document.querySelectorAll<HTMLButtonElement>(
			"[data-example-prompt]",
		);
		expect(examples.length).toBeGreaterThan(0);

		await user.click(
			document.querySelector<HTMLButtonElement>("[data-voice-picker]")!,
		);
		expect(
			document.querySelector('[data-voice-option="voices/ben.bin"]'),
		).toBeTruthy();
		expect(voiceInput()).toBeNull();
	});

	it("shows no English examples for a model that declares other languages", () => {
		setup({
			model: LOCAL,
			modelInfo: { ...LOCAL_INFO, languages: ["ja"] } as typeof LOCAL_INFO,
		});
		expect(document.querySelectorAll("[data-example-prompt]")).toHaveLength(0);
	});

	it("text-to-audio mode has no voice and sends only the prompt", async () => {
		const { user } = setup({ mode: "text-to-audio", model: AUDIO });

		expect(document.querySelector("[data-voice-picker]")).toBeNull();
		expect(voiceInput()).toBeNull();
		expect(document.querySelector("[data-speech-settings-toggle]")).toBeNull();
		const chips = document.querySelectorAll<HTMLButtonElement>(
			"[data-example-prompt]",
		);
		expect(chips.length).toBeGreaterThanOrEqual(3);

		await user.click(chips[0]!);
		expect(input().value).toBe(chips[0]!.textContent);
		await user.click(generateButton());

		await waitFor(() => expect(generateSpeech).toHaveBeenCalledTimes(1));
		expect(generateSpeech.mock.calls[0]![0]).toMatchObject({
			mode: "text-to-audio",
			voice: "default",
		});
		expect(generateSpeech.mock.calls[0]![0].instructions).toBeUndefined();
	});
});
