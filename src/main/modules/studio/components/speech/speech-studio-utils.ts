import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { MediaVoice } from "@/types/openai-media";
import type { StudioItem } from "@/types/studio";
import { isEnglishOnly, languagesOf } from "../../studio-model-info";

/** The OpenAI `/audio/speech` API rejects input longer than this. */
export const SPEECH_INPUT_LIMIT = 4096;
/** Where the counter starts warning, so the limit is not a surprise. */
export const SPEECH_INPUT_WARN = 4000;

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;
export const DEFAULT_SPEED = 1;

/**
 * English sample prompts. Only offered when the model does not declare
 * languages that exclude English - a sample the model cannot speak is a bad
 * first impression.
 */
const ENGLISH_EXAMPLES = [
	"Hello! Welcome to Memorall, your browser's second brain.",
	"The quick brown fox jumps over the lazy dog.",
	"Here is your morning briefing: three meetings and one deadline today.",
];

/** Prompt ideas for text-to-audio models. */
export const MUSIC_EXAMPLES = [
	"Lo-fi hip hop beat with warm piano and soft rain",
	"Upbeat 80s synthwave with driving drums, 120 BPM",
	"Calm acoustic guitar, gentle and relaxing",
	"Epic orchestral trailer music with big drums",
];

export function speechExamplesFor(info: ModelInfo | undefined): string[] {
	const languages = languagesOf(info);
	return languages.length === 0 ||
		languages.includes("en") ||
		isEnglishOnly(info)
		? ENGLISH_EXAMPLES
		: [];
}

const storageKey = (
	kind: string,
	model?: Pick<CurrentModelInfo, "modelId" | "provider">,
) =>
	model
		? `memorall.studio.speech.${kind}.${model.provider}:${model.modelId}`
		: `memorall.studio.speech.${kind}`;

const readStorage = (key: string): string | null => {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

const writeStorage = (key: string, value: string) => {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Storage can be blocked (private windows); the choice just is not remembered.
	}
};

/** The last voice used with this model, if it still exists; else the first. */
export function initialVoiceFor(
	model: Pick<CurrentModelInfo, "modelId" | "provider">,
	voices: MediaVoice[],
): string {
	const stored = readStorage(storageKey("voice", model));
	if (stored && voices.some((voice) => voice.id === stored)) return stored;
	return voices[0]?.id ?? stored ?? "";
}

export const rememberVoice = (
	model: Pick<CurrentModelInfo, "modelId" | "provider">,
	voice: string,
) => writeStorage(storageKey("voice", model), voice);

export const readLivePlayback = () => readStorage(storageKey("live")) !== "off";

export const rememberLivePlayback = (enabled: boolean) =>
	writeStorage(storageKey("live"), enabled ? "on" : "off");

export interface SpeechParams {
	voice?: string;
	speed?: number;
	instructions?: string;
	seed?: number;
	duration?: number;
}

/** Lengths offered for generated audio, in seconds. */
export const MUSIC_DURATIONS = [5, 10, 15, 30] as const;
export const DEFAULT_MUSIC_DURATION = 10;

/** `generation.params` is stored as loose JSON; read it defensively. */
export function paramsOf(item: StudioItem): SpeechParams {
	const params = item.generation.params ?? {};
	return {
		voice: typeof params.voice === "string" ? params.voice : undefined,
		speed: typeof params.speed === "number" ? params.speed : undefined,
		instructions:
			typeof params.instructions === "string" ? params.instructions : undefined,
		seed: typeof params.seed === "number" ? params.seed : undefined,
		duration: typeof params.duration === "number" ? params.duration : undefined,
	};
}

export function promptOf(item: StudioItem): string {
	for (const part of item.parts) {
		if (part.type === "text" && part.role === "prompt") return part.text;
	}
	return item.content;
}

export function outputAudioOf(item: StudioItem) {
	for (const part of item.parts) {
		if (part.type === "output_audio") return part.output_audio;
	}
	return null;
}

export const prefersReducedMotion = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const formatSpeed = (speed: number) =>
	`${speed.toFixed(2).replace(/0$/, "")}×`;
