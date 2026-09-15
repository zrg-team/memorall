import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import { isEnglishOnly } from "../../studio-model-info";

export type TranscriptionTask = "transcribe" | "translate";

/** Uploads larger than this are refused before anything is stored. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const AUDIO_ACCEPT = "audio/*,video/webm,video/mp4";

export const isAcceptedAudio = (file: Pick<File, "type" | "name">) =>
	file.type.startsWith("audio/") ||
	file.type === "video/webm" ||
	file.type === "video/mp4" ||
	// Some systems report no type for .m4a/.opus files dragged from a file manager.
	(!file.type &&
		/\.(mp3|wav|m4a|ogg|oga|opus|flac|webm|mp4|aac)$/i.test(file.name));

/**
 * Languages offered when the model is multilingual. Names are endonyms so the
 * list reads right whatever language the app is in, and needs no translation.
 */
export const TRANSCRIPTION_LANGUAGES: ReadonlyArray<{
	code: string;
	name: string;
}> = [
	{ code: "en", name: "English" },
	{ code: "vi", name: "Tiếng Việt" },
	{ code: "zh", name: "中文" },
	{ code: "ja", name: "日本語" },
	{ code: "ko", name: "한국어" },
	{ code: "es", name: "Español" },
	{ code: "fr", name: "Français" },
	{ code: "de", name: "Deutsch" },
	{ code: "pt", name: "Português" },
	{ code: "it", name: "Italiano" },
	{ code: "ru", name: "Русский" },
	{ code: "hi", name: "हिन्दी" },
	{ code: "th", name: "ไทย" },
	{ code: "id", name: "Bahasa Indonesia" },
	{ code: "ar", name: "العربية" },
	{ code: "tr", name: "Türkçe" },
	{ code: "nl", name: "Nederlands" },
	{ code: "pl", name: "Polski" },
	{ code: "uk", name: "Українська" },
];

/**
 * Whether the language picker makes sense: only a model that declares
 * English alone is known not to take one.
 */
export function isMultilingualModel(info: ModelInfo | undefined): boolean {
	return !isEnglishOnly(info);
}

/**
 * Whether to offer "translate to English". It is a standard transcription
 * option; a model that cannot translate returns a plain transcript or an
 * error on the card.
 */
export function supportsTranslation(info: ModelInfo | undefined): boolean {
	return isMultilingualModel(info);
}

/** Human label for a detected or requested language code ("en", "english"). */
export function languageLabel(
	language: string | undefined,
): string | undefined {
	if (!language) return undefined;
	const known = TRANSCRIPTION_LANGUAGES.find(
		(entry) => entry.code === language.toLowerCase(),
	);
	if (known) return known.code.toUpperCase();
	return language.length <= 3
		? language.toUpperCase()
		: language.charAt(0).toUpperCase() + language.slice(1);
}
