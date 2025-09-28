import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	actualTheme: "light" | "dark"; // The actual resolved theme (system resolves to light/dark)
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
};

interface ThemeProviderProps {
	children: React.ReactNode;
	defaultTheme?: Theme;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
	children,
	defaultTheme = "system",
}) => {
	const [theme, setThemeState] = useState<Theme>(() => {
		// Try to get theme from localStorage first
		if (typeof window !== "undefined") {
			const savedTheme = localStorage.getItem("theme") as Theme;
			if (savedTheme && ["light", "dark", "system"].includes(savedTheme)) {
				return savedTheme;
			}
		}
		return defaultTheme;
	});

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

	// Apply theme class to document root
	useEffect(() => {
		const root = window.document.documentElement;
		root.classList.remove("light", "dark");
		root.classList.add(actualTheme);
	}, [actualTheme]);

	const setTheme = (newTheme: Theme) => {
		setThemeState(newTheme);
		if (typeof window !== "undefined") {
			localStorage.setItem("theme", newTheme);
		}
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
