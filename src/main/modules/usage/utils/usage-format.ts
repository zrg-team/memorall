import type { UsageMetric } from "../types";

/** Rough size of a tool result in tokens, from its characters. */
export const CHARS_PER_TOKEN = 4;

export const formatUsd = (value: number): string => {
	const size = Math.abs(value);
	if (size === 0) return "$0.00";
	if (size < 0.01) return "<$0.01";
	if (size < 1000) return `$${value.toFixed(2)}`;
	return `$${(value / 1000).toFixed(1)}K`;
};

/** Small per-call amounts keep their digits: $0.0049, $0.023. */
export const formatUsdPrecise = (value: number): string => {
	const size = Math.abs(value);
	if (size === 0) return "$0";
	if (size < 0.01) return `$${value.toFixed(4)}`;
	if (size < 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
};

const trimZero = (text: string) => text.replace(/\.0$/, "");

export const formatTokens = (value: number): string => {
	const size = Math.abs(value);
	if (size >= 1e9) return `${trimZero((value / 1e9).toFixed(1))}B`;
	if (size >= 1e6) {
		return `${trimZero((value / 1e6).toFixed(size >= 1e8 ? 0 : 1))}M`;
	}
	if (size >= 1e3) {
		return `${trimZero((value / 1e3).toFixed(size >= 1e5 ? 0 : 1))}K`;
	}
	return String(Math.round(value));
};

export const formatCount = (value: number): string =>
	Math.round(value).toLocaleString("en-US");

export const formatMetric = (value: number, metric: UsageMetric): string =>
	metric === "cost" ? formatUsd(value) : formatTokens(value);

export const formatPercent = (ratio: number): string => {
	if (ratio >= 0.995) return "100%";
	if (ratio > 0 && ratio < 0.01) return "<1%";
	return `${Math.round(ratio * 100)}%`;
};

/** `▲ 12%`, `▼ 4.5%`; small changes keep one decimal. */
export const formatChange = (change: number): string => {
	const size = Math.abs(change * 100);
	const digits = size >= 999 ? "999+" : size.toFixed(size < 10 ? 1 : 0);
	return `${change > 0 ? "▲" : "▼"} ${digits}%`;
};

export const formatAxisValue = (
	value: number,
	step: number,
	metric: UsageMetric,
): string => {
	if (metric === "tokens") return value === 0 ? "0" : formatTokens(value);
	if (value === 0) return "$0";
	if (step < 0.01) return `$${value.toFixed(3)}`;
	if (step < 1) return `$${value.toFixed(2)}`;
	return `$${value.toFixed(0)}`;
};

/** Round axis ticks from zero: steps of 1, 2 or 5 × 10ⁿ. */
export const niceTicks = (max: number, count = 4) => {
	if (!(max > 0)) return { ticks: [0, 1], top: 1, step: 1 };
	const raw = max / count;
	const power = 10 ** Math.floor(Math.log10(raw));
	const fraction = raw / power;
	const step =
		(fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
	const top = Math.ceil(max / step - 1e-9) * step;
	const ticks: number[] = [];
	for (let index = 0; index * step <= top + step / 2; index++) {
		ticks.push(Number((index * step).toFixed(10)));
	}
	return { ticks, top, step };
};

/** i18next uses `vn`; Intl wants `vi`. */
export const toDateLocale = (language: string | undefined) =>
	language?.startsWith("vn") || language?.startsWith("vi") ? "vi" : "en-US";

export const formatShortDate = (at: number, locale: string) =>
	new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" });

export const formatLongDate = (at: number, locale: string) =>
	new Date(at).toLocaleDateString(locale, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
