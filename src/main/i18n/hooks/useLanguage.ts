/**
 * Language Hook
 * Custom hook for managing language switching with platform storage sync
 */

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { logInfo, logError } from "@/utils/logger";
import { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE } from "@/constants/language";
import type { Language } from "@/constants/language";
import { platform } from "@/platform/current";

export type { Language };

/**
 * Hook for managing language with cross-context platform storage sync
 */
export function useLanguage() {
	const { i18n } = useTranslation();

	// Load language from persistent platform storage on mount
	useEffect(() => {
		const loadLanguage = async () => {
			try {
				const savedLanguage =
					await platform.persistentStore.get<Language>(LANGUAGE_STORAGE_KEY);

				if (
					savedLanguage &&
					(savedLanguage === "en" || savedLanguage === "vn")
				) {
					if (i18n.language !== savedLanguage) {
						await i18n.changeLanguage(savedLanguage);
						logInfo(`Language loaded from storage: ${savedLanguage}`);
					}
				} else {
					// Set default language if none saved
					await platform.persistentStore.set(
						LANGUAGE_STORAGE_KEY,
						DEFAULT_LANGUAGE,
					);
				}
			} catch (error) {
				logError("Failed to load language from storage:", error);
			}
		};

		loadLanguage();
	}, [i18n]);

	// Listen for language changes from other contexts
	useEffect(() => {
		return platform.persistentStore.subscribe<Language>(
			LANGUAGE_STORAGE_KEY,
			(newLanguage) => {
				if (newLanguage && i18n.language !== newLanguage) {
					void i18n.changeLanguage(newLanguage);
					logInfo(`Language changed from storage: ${newLanguage}`);
				}
			},
		);
	}, [i18n]);

	// Change language and save to storage
	const changeLanguage = useCallback(
		async (lang: Language) => {
			try {
				await i18n.changeLanguage(lang);
				await platform.persistentStore.set(LANGUAGE_STORAGE_KEY, lang);
				logInfo(`Language changed to: ${lang}`);
			} catch (error) {
				logError("Failed to change language:", error);
			}
		},
		[i18n],
	);

	return {
		language: i18n.language as Language,
		changeLanguage,
		isEnglish: i18n.language === "en",
		isVietnamese: i18n.language === "vn",
	};
}
