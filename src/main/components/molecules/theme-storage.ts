import { platform } from "@/platform/current";
import { isTheme, type Theme, type ThemeStorage } from "./ThemeContext";

/**
 * Theme preference sharing between the app's own surfaces and the injected
 * in-page copilot.
 *
 * `platform.persistentStore` is the only store the two actually share. Inside a
 * content script `localStorage` and `indexedDB` belong to the *host page*, so the
 * copilot cannot read what the options page wrote to either — which is why the
 * in-page UI used to follow the OS preference instead of the user's choice.
 *
 * The app surfaces stay authoritative: they read/write `localStorage`
 * synchronously (no first-paint flash) and mirror every change into the shared
 * store. The copilot only reads.
 */
export const THEME_STORAGE_KEY = "memorallTheme";

const LEGACY_LOCAL_STORAGE_KEY = "theme";

const subscribeToSharedTheme = (
	onChange: (theme: Theme) => void,
): (() => void) => {
	// The shared store is async, so the value in it at mount time has to be
	// fetched explicitly; `subscribe` only reports later changes.
	void platform.persistentStore
		.get<Theme>(THEME_STORAGE_KEY)
		.then((stored) => {
			if (isTheme(stored)) onChange(stored);
		})
		.catch(() => {
			// A missing preference is normal on first run; keep the default.
		});

	return platform.persistentStore.subscribe<Theme>(
		THEME_STORAGE_KEY,
		(next) => {
			if (isTheme(next)) onChange(next);
		},
	);
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
		void platform.persistentStore.set(THEME_STORAGE_KEY, theme).catch(() => {
			// Mirroring is best-effort; the local preference already applied.
		});
	},
	subscribe: subscribeToSharedTheme,
};

/**
 * For the in-page copilot's shadow roots: follows the app, never writes.
 * `read` is omitted because the shared store is async — the initial value
 * arrives through `subscribe`.
 */
export const embeddedThemeStorage: ThemeStorage = {
	subscribe: subscribeToSharedTheme,
};
