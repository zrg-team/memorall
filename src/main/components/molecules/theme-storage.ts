import { isTheme, type Theme, type ThemeStorage } from "./ThemeContext";

/**
 * Theme preference sharing between the extension's own pages and the injected
 * in-page copilot.
 *
 * `chrome.storage.local` is the only store the two actually share. Inside a
 * content script `localStorage` and `indexedDB` belong to the *host page*, so the
 * copilot cannot read what the options page wrote to either — which is why the
 * in-page UI used to follow the OS preference instead of the user's choice.
 *
 * The extension pages stay authoritative: they read/write `localStorage`
 * synchronously (no first-paint flash) and mirror every change here. The copilot
 * only reads.
 */
export const THEME_STORAGE_KEY = "memorallTheme";

const LEGACY_LOCAL_STORAGE_KEY = "theme";

const extensionStorage = (): chrome.storage.LocalStorageArea | null => {
	try {
		return typeof chrome !== "undefined" && chrome.storage?.local
			? chrome.storage.local
			: null;
	} catch {
		return null;
	}
};

const subscribeToExtensionTheme = (
	onChange: (theme: Theme) => void,
): (() => void) => {
	const storage = extensionStorage();
	if (!storage) return () => {};

	void storage
		.get(THEME_STORAGE_KEY)
		.then((result) => {
			const stored = result?.[THEME_STORAGE_KEY];
			if (isTheme(stored)) onChange(stored);
		})
		.catch(() => {
			// A missing preference is normal on first run; keep the default.
		});

	const listener = (
		changes: Record<string, chrome.storage.StorageChange>,
		areaName: string,
	) => {
		if (areaName !== "local") return;
		const next = changes[THEME_STORAGE_KEY]?.newValue;
		if (isTheme(next)) onChange(next);
	};

	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
};

/** For the extension pages, web and desktop: owns the preference. */
export const appThemeStorage: ThemeStorage = {
	read: () => {
		if (typeof window === "undefined") return null;
		const saved = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
		return isTheme(saved) ? saved : null;
	},
	write: (theme) => {
		if (typeof window !== "undefined") {
			localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, theme);
		}
		void extensionStorage()
			?.set({ [THEME_STORAGE_KEY]: theme })
			.catch(() => {
				// Mirroring is best-effort; the local preference already applied.
			});
	},
	subscribe: subscribeToExtensionTheme,
};

/**
 * For the in-page copilot's shadow roots: follows the app, never writes.
 * `read` is omitted because `chrome.storage` is async — the initial value
 * arrives through `subscribe`.
 */
export const embeddedThemeStorage: ThemeStorage = {
	subscribe: subscribeToExtensionTheme,
};
