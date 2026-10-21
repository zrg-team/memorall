/** Shared endonyms for the live reader and Studio. Codes are validated at the owner. */
export const TRANSCRIPT_LANGUAGES = [
	{ code: "en", name: "English", english: "English" },
	{ code: "vi", name: "Tiếng Việt", english: "Vietnamese" },
	{ code: "zh", name: "中文", english: "Chinese (Simplified)" },
	{ code: "zh-TW", name: "繁體中文", english: "Chinese (Traditional)" },
	{ code: "ja", name: "日本語", english: "Japanese" },
	{ code: "ko", name: "한국어", english: "Korean" },
	{ code: "es", name: "Español", english: "Spanish" },
	{ code: "fr", name: "Français", english: "French" },
	{ code: "de", name: "Deutsch", english: "German" },
	{ code: "pt", name: "Português", english: "Portuguese" },
	{ code: "it", name: "Italiano", english: "Italian" },
	{ code: "ru", name: "Русский", english: "Russian" },
	{ code: "hi", name: "हिन्दी", english: "Hindi" },
	{ code: "th", name: "ไทย", english: "Thai" },
	{ code: "id", name: "Bahasa Indonesia", english: "Indonesian" },
	{ code: "ar", name: "العربية", english: "Arabic" },
	{ code: "tr", name: "Türkçe", english: "Turkish" },
	{ code: "nl", name: "Nederlands", english: "Dutch" },
	{ code: "pl", name: "Polski", english: "Polish" },
	{ code: "uk", name: "Українська", english: "Ukrainian" },
	{ code: "sv", name: "Svenska", english: "Swedish" },
	{ code: "da", name: "Dansk", english: "Danish" },
	{ code: "fi", name: "Suomi", english: "Finnish" },
	{ code: "no", name: "Norsk", english: "Norwegian" },
	{ code: "cs", name: "Čeština", english: "Czech" },
	{ code: "el", name: "Ελληνικά", english: "Greek" },
	{ code: "he", name: "עברית", english: "Hebrew" },
	{ code: "ms", name: "Bahasa Melayu", english: "Malay" },
	{ code: "ro", name: "Română", english: "Romanian" },
	{ code: "hu", name: "Magyar", english: "Hungarian" },
	{ code: "bn", name: "বাংলা", english: "Bengali" },
	{ code: "ta", name: "தமிழ்", english: "Tamil" },
	{ code: "tl", name: "Filipino", english: "Filipino" },
] as const;

export const transcriptLanguage = (code?: string) =>
	TRANSCRIPT_LANGUAGES.find((language) => language.code === code);
export const validTranscriptLanguage = (code: unknown): code is string =>
	typeof code === "string" && !!transcriptLanguage(code);

/** Hosted STT expects ISO-639-1 even when its response spelled out the language. */
export function transcriptionLanguageCode(value?: string): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (/^[a-z]{2}$/.test(normalized)) return normalized;
	const language = TRANSCRIPT_LANGUAGES.find(
		(language) =>
			language.code.toLowerCase() === normalized ||
			language.english.toLowerCase() === normalized ||
			language.name.toLowerCase() === normalized,
	);
	if (language) return language.code === "zh-TW" ? "zh" : language.code;
	return normalized === "chinese" ? "zh" : undefined;
}
