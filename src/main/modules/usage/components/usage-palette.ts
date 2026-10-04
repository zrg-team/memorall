import { useTheme } from "@/main/components/molecules/ThemeContext";

/**
 * Chart colors, picked per theme. The five series slots are a validated
 * categorical order (CVD-safe for neighbours in stacks and lists); a sixth
 * series always folds into "Other". Text never wears these colors.
 */
export interface UsagePalette {
	series: readonly string[];
	other: string;
	previous: string;
	spark: string;
	grid: string;
	axis: string;
	/** Weight ramp for the weekday × hour grid, empty first. */
	heat: readonly string[];
	meterTrack: string;
	meterFill: string;
	warning: string;
	good: string;
	/** Text-safe change colors: spend down / spend up. */
	goodText: string;
	badText: string;
	/** Chart surface: gaps between stacked marks and rings around dots. */
	surface: string;
}

const LIGHT: UsagePalette = {
	series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
	other: "#b9b8b2",
	previous: "#a3a29c",
	spark: "#b9b8b2",
	grid: "#ececea",
	axis: "#c9c8c2",
	heat: [
		"#f3f3f1",
		"#cde2fb",
		"#9ec5f4",
		"#6da7ec",
		"#3987e5",
		"#256abf",
		"#184f95",
	],
	meterTrack: "#cde2fb",
	meterFill: "#2a78d6",
	warning: "#fab219",
	good: "#0ca30c",
	goodText: "#006300",
	badText: "#d03b3b",
	surface: "hsl(var(--background))",
};

const DARK: UsagePalette = {
	series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
	other: "#575651",
	previous: "#6e6d68",
	spark: "#5f5e5a",
	grid: "#222221",
	axis: "#3a3a37",
	heat: [
		"#191918",
		"#13294a",
		"#184f95",
		"#1c5cab",
		"#2a78d6",
		"#5598e7",
		"#9ec5f4",
	],
	meterTrack: "#1c3557",
	meterFill: "#3987e5",
	warning: "#fab219",
	good: "#0ca30c",
	goodText: "#0ca30c",
	badText: "#ef6b6b",
	surface: "hsl(var(--background))",
};

export const usagePaletteFor = (theme: "light" | "dark"): UsagePalette =>
	theme === "dark" ? DARK : LIGHT;

export const useUsagePalette = (): UsagePalette => {
	const { actualTheme } = useTheme();
	return usagePaletteFor(actualTheme === "dark" ? "dark" : "light");
};

/** Slot colors by all-time rank; everything past the fifth is "Other". */
export const assignSeriesColors = <K>(
	ranked: readonly K[],
	palette: UsagePalette,
): Map<K, string> =>
	new Map(
		ranked.map((key, index) => [key, palette.series[index] ?? palette.other]),
	);
