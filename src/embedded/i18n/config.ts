import {
	DEFAULT_LANGUAGE,
	LANGUAGE_STORAGE_KEY,
	type Language,
} from "@/constants/language";
import { logWarn } from "@/utils/logger";
import { platform } from "@/platform/current";
import { enEmbeddedLocale } from "./locales/en";
import { vnEmbeddedLocale } from "./locales/vn";

export const EMBEDDED_TRANSLATIONS = {
	en: enEmbeddedLocale,
	vn: vnEmbeddedLocale,
};

export type EmbeddedTranslations = typeof EMBEDDED_TRANSLATIONS;
export type EmbeddedLocale = EmbeddedTranslations[Language];

export async function loadLanguageFromStorage(): Promise<Language> {
	try {
		const savedLanguage =
			await platform.persistentStore.get<Language>(LANGUAGE_STORAGE_KEY);

		if (savedLanguage && (savedLanguage === "en" || savedLanguage === "vn")) {
			return savedLanguage;
		}
	} catch (error) {
		logWarn("Failed to load language:", error);
	}
	return DEFAULT_LANGUAGE;
}

export async function loadEmbeddedTranslationScope<
	Scope extends keyof EmbeddedLocale,
>(scope: Scope): Promise<EmbeddedLocale[Scope]> {
	const language = await loadLanguageFromStorage();
	return EMBEDDED_TRANSLATIONS[language][scope];
}
