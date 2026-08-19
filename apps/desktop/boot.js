/**
 * Pre-React boot step for the desktop window.
 *
 * Loaded as a classic script at the end of `index.html`, so it runs during HTML
 * parsing — before the app's module bundle has even been fetched. Three things
 * happen here before the user ever sees the window:
 *
 *   1. The resolved theme class lands on `<html>` *before* the first React
 *      commit. `ThemeProvider` applies the same class from an effect, i.e. after
 *      paint, so without this the app painted light and then snapped to dark.
 *   2. The window — created hidden in `tauri.conf.json` — is revealed with its
 *      background already set to the resolved theme colour, so the compositor
 *      never puts a white (or black) frame on screen ahead of the splash.
 *   3. The splash cross-fades out as soon as React commits its own loading
 *      screen, leaving no blank frame between the two.
 *
 * This is deliberately plain, un-bundled JavaScript rather than a Vite entry:
 * Vite folds every module entry of a page into one chunk, which would mean
 * waiting on the whole ~800 kB app bundle before the window could appear. It
 * cannot be inline in `index.html` either — the Tauri CSP allows inline styles
 * but not inline scripts. `vite.config.ts` copies this file into the build.
 *
 * Keep it dependency-free and side-effect-local; nothing in `src/` imports it,
 * and the handover in (3) is therefore observed from the DOM rather than being
 * called by `main.tsx`.
 */
(() => {
	"use strict";

	const THEME_STORAGE_KEY = "theme";
	const ROOT_ELEMENT_ID = "root";
	const SPLASH_ELEMENT_ID = "boot-splash";
	const SPLASH_FADE_MS = 220;
	/** Backstop so a failed app boot never leaves the splash covering the window. */
	const SPLASH_MAX_LIFETIME_MS = 20000;
	const BACKGROUND_BY_THEME = { dark: "#0A0A0A", light: "#FFFFFF" };

	/** @returns {"light" | "dark"} */
	function resolveTheme() {
		let stored = null;
		try {
			stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			// Private/blocked storage: fall through to the system preference.
		}

		if (stored === "light" || stored === "dark") return stored;

		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	}

	/** @returns {"light" | "dark"} */
	function applyTheme() {
		const theme = resolveTheme();
		const root = document.documentElement;
		root.classList.remove("light", "dark");
		root.classList.add(theme);
		return theme;
	}

	/** @param {() => void} callback */
	function afterNextPaint(callback) {
		// One frame schedules the paint, the second fires once it is composited.
		requestAnimationFrame(() => requestAnimationFrame(callback));
	}

	/**
	 * Reveal the window immediately rather than after a paint: a hidden window has
	 * no compositor, so `requestAnimationFrame` never fires and gating on it would
	 * deadlock the reveal until the Rust watchdog fires. Handing Rust the resolved
	 * background means the very first composited frame is already the theme
	 * colour, and the splash paints over it a frame later.
	 *
	 * @param {"light" | "dark"} theme
	 */
	function showDesktopWindow(theme) {
		const internals = window.__TAURI_INTERNALS__;
		if (!internals || typeof internals.invoke !== "function") return;

		Promise.resolve(
			internals.invoke("show_main_window", {
				background: BACKGROUND_BY_THEME[theme],
			}),
		).catch((error) => {
			// Rust also reveals the window on a watchdog timer, so a failure here
			// degrades to "window appears later", never "no window at all".
			console.error("Failed to reveal the desktop window", error);
		});
	}

	let splashDismissed = false;

	function dismissSplash() {
		if (splashDismissed) return;
		splashDismissed = true;

		const splash = document.getElementById(SPLASH_ELEMENT_ID);
		if (!splash) return;

		afterNextPaint(() => {
			splash.dataset.dismissed = "true";
			window.setTimeout(() => splash.remove(), SPLASH_FADE_MS);
		});
	}

	function handOverToApp() {
		const root = document.getElementById(ROOT_ELEMENT_ID);
		if (!root) return;

		if (root.childElementCount > 0) {
			dismissSplash();
			return;
		}

		const observer = new MutationObserver(() => {
			if (root.childElementCount === 0) return;
			observer.disconnect();
			dismissSplash();
		});
		observer.observe(root, { childList: true });

		window.setTimeout(() => {
			observer.disconnect();
			dismissSplash();
		}, SPLASH_MAX_LIFETIME_MS);
	}

	const bootTheme = applyTheme();
	showDesktopWindow(bootTheme);
	handOverToApp();
})();
