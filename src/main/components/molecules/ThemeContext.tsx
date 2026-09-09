import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeContextType {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	actualTheme: "light" | "dark"; // The actual resolved theme (system resolves to light/dark)
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const prefersDark = () =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-color-scheme: dark)").matches;

// Tracks the OS preference so surfaces rendered without a provider still resolve
// a live theme instead of a frozen guess.
const useSystemTheme = (): "light" | "dark" => {
	const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
		prefersDark() ? "dark" : "light",
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => setSystemTheme(prefersDark() ? "dark" : "light");
		handleChange();

		if (mediaQuery.addEventListener) {
			mediaQuery.addEventListener("change", handleChange);
			return () => mediaQuery.removeEventListener("change", handleChange);
		}
		mediaQuery.addListener(handleChange);
		return () => mediaQuery.removeListener(handleChange);
	}, []);

	return systemTheme;
};

const noopSetTheme = () => {};

// Deliberately does not throw when no provider is mounted. Consumers can sit deep
// inside error-boundary fallbacks (OpenUIRenderer renders MarkdownMessage from
// its own render()), where a throw escapes the boundary and unmounts the whole
// tree rather than degrading to plain markdown.
export const useTheme = (): ThemeContextType => {
	const context = useContext(ThemeContext);
	const systemTheme = useSystemTheme();

	if (context) return context;
	return { theme: "system", setTheme: noopSetTheme, actualTheme: systemTheme };
};

export const isTheme = (value: unknown): value is Theme =>
	value === "light" || value === "dark" || value === "system";

/**
 * Where the preference is read from and written to. Injected so surfaces that do
 * not own `window.localStorage` — the content-script shadow roots read the *host
 * page's* storage, not ours — can supply their own backing store.
 */
export interface ThemeStorage {
	read?: () => Theme | null;
	write?: (theme: Theme) => void;
	subscribe?: (onChange: (theme: Theme) => void) => () => void;
}

const localStorageTheme: ThemeStorage = {
	read: () => {
		if (typeof window === "undefined") return null;
		const savedTheme = localStorage.getItem("theme");
		return isTheme(savedTheme) ? savedTheme : null;
	},
	write: (theme) => {
		if (typeof window === "undefined") return;
		localStorage.setItem("theme", theme);
	},
};

interface ThemeProviderProps {
	children: React.ReactNode;
	defaultTheme?: Theme;
	/**
	 * Element that receives the `light`/`dark` class. Defaults to the document
	 * root; shadow-root surfaces pass their own container so the injected UI does
	 * not restyle the page it is sitting on.
	 */
	themeTarget?: HTMLElement | null;
	storage?: ThemeStorage;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
	children,
	defaultTheme = "system",
	themeTarget,
	storage = localStorageTheme,
}) => {
	const [theme, setThemeState] = useState<Theme>(
		() => storage.read?.() ?? defaultTheme,
	);

	// Late-arriving or externally-changed preference (async stores, other surfaces).
	useEffect(() => {
		if (!storage.subscribe) return;
		return storage.subscribe((nextTheme) => {
			if (isTheme(nextTheme)) setThemeState(nextTheme);
		});
	}, [storage]);

	const [actualTheme, setActualTheme] = useState<"light" | "dark">(() => {
		// Determine initial actual theme
		if (theme === "system") {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return theme as "light" | "dark";
	});

	// Update actual theme when theme changes or system preference changes
	useEffect(() => {
		const updateActualTheme = () => {
			if (theme === "system") {
				const systemDark = window.matchMedia(
					"(prefers-color-scheme: dark)",
				).matches;
				setActualTheme(systemDark ? "dark" : "light");
			} else {
				setActualTheme(theme as "light" | "dark");
			}
		};

		updateActualTheme();

		// Listen for system theme changes if theme is set to system
		if (theme === "system") {
			const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
			const handleChange = () => updateActualTheme();

			// Use the modern addEventListener if available, fallback to addListener
			if (mediaQuery.addEventListener) {
				mediaQuery.addEventListener("change", handleChange);
				return () => mediaQuery.removeEventListener("change", handleChange);
			} else {
				// Fallback for older browsers
				mediaQuery.addListener(handleChange);
				return () => mediaQuery.removeListener(handleChange);
			}
		}
	}, [theme]);

	// Apply theme class to the target element (document root by default)
	useEffect(() => {
		const root = themeTarget ?? window.document.documentElement;
		root.classList.remove("light", "dark");
		root.classList.add(actualTheme);
	}, [actualTheme, themeTarget]);

	const setTheme = (newTheme: Theme) => {
		setThemeState(newTheme);
		storage.write?.(newTheme);
	};

	const value: ThemeContextType = {
		theme,
		setTheme,
		actualTheme,
	};

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
};
