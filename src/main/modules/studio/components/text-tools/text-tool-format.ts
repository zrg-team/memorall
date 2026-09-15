import type { TextToolTask } from "@/services/llm/interfaces/model-category";
import type { ImageToolLabel, TextToolRanking } from "@/types/openai-media";
import type { StudioContentPart, StudioItem } from "@/types/studio";

/** The template zero-shot models use when none is given; `{}` is the label. */
export const DEFAULT_HYPOTHESIS_TEMPLATE = "This example is {}.";

/** Comma-separated labels, trimmed, blanks and repeats dropped. */
export const parseLabels = (text: string): string[] =>
	uniqueNonEmpty(text.split(","));

/** One document per line, trimmed, blank lines dropped. */
export const parseDocuments = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

export const uniqueNonEmpty = (values: readonly string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
		seen.add(trimmed.toLowerCase());
		result.push(trimmed);
	}
	return result;
};

const stringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];

export const textTaskOfItem = (item: StudioItem): TextToolTask | undefined =>
	item.generation.textTask ??
	(typeof item.generation.params?.task === "string"
		? (item.generation.params.task as TextToolTask)
		: undefined);

/** The text that was classified, or the query documents were ranked against. */
export const inputTextOf = (item: StudioItem): string =>
	item.parts.find(
		(part): part is Extract<StudioContentPart, { type: "text" }> =>
			part.type === "text" && part.role === "prompt",
	)?.text ?? item.content;

export interface TextToolRequestParams {
	labels: string[];
	documents: string[];
	multiLabel: boolean;
	hypothesisTemplate?: string;
}

export const requestParamsOf = (item: StudioItem): TextToolRequestParams => {
	const params = item.generation.params ?? {};
	return {
		labels: stringArray(params.labels),
		documents: stringArray(params.documents),
		multiLabel: params.multiLabel === true,
		hypothesisTemplate:
			typeof params.hypothesisTemplate === "string"
				? params.hypothesisTemplate
				: undefined,
	};
};

/** Classification results, best first. */
export const resultLabelsOf = (item: StudioItem): ImageToolLabel[] =>
	[
		...(item.parts.find(
			(part): part is Extract<StudioContentPart, { type: "labels" }> =>
				part.type === "labels",
		)?.labels ?? []),
	].sort((a, b) => b.score - a.score);

/** Ranking results, most relevant first. */
export const resultRankingOf = (item: StudioItem): TextToolRanking[] =>
	[
		...(item.parts.find(
			(part): part is Extract<StudioContentPart, { type: "ranking" }> =>
				part.type === "ranking",
		)?.ranking ?? []),
	].sort((a, b) => b.score - a.score);

export const formatPercent = (score: number) =>
	`${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;

/** Plain-text results, one per line, for the clipboard. */
export const resultsAsText = (
	labels: readonly ImageToolLabel[],
	ranking: readonly TextToolRanking[],
): string =>
	[
		...labels.map((entry) => `${entry.label}\t${formatPercent(entry.score)}`),
		...ranking.map(
			(entry, position) =>
				`${position + 1}.\t${formatPercent(entry.score)}\t${entry.document}`,
		),
	].join("\n");

const quote = (text: string) =>
	text
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");

/** A readable Markdown record of one run: the input, then the results. */
export const resultsAsMarkdown = (options: {
	taskLabel: string;
	input: string;
	inputHeading: string;
	resultsHeading: string;
	labels: readonly ImageToolLabel[];
	ranking: readonly TextToolRanking[];
}): string => {
	const sections = [
		`# ${options.taskLabel}`,
		`## ${options.inputHeading}`,
		quote(options.input),
		`## ${options.resultsHeading}`,
	];
	if (options.labels.length > 0) {
		sections.push(
			options.labels
				.map((entry) => `- **${entry.label}**: ${formatPercent(entry.score)}`)
				.join("\n"),
		);
	}
	if (options.ranking.length > 0) {
		sections.push(
			options.ranking
				.map(
					(entry, position) =>
						`${position + 1}. (${formatPercent(entry.score)}) ${entry.document.replace(/\s*\r?\n\s*/g, " ")}`,
				)
				.join("\n"),
		);
	}
	return `${sections.join("\n\n")}\n`;
};

/** A file name from the start of the input: "the-battery-died.md". */
export const markdownFileName = (input: string, fallback = "text-tools") => {
	const slug =
		input
			.toLowerCase()
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.replace(/đ/g, "d")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48)
			.replace(/-+$/g, "") || fallback;
	return `${slug}.md`;
};
