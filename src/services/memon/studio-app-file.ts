import { MEMON_STUDIO_LABELS, type MemonStudioToolId } from "./constants";
import type { MemonStudioRequest } from "./studio-app";

/**
 * A `.studio` file: a studio tool set up for one job, like an app on the
 * desktop. "Analyze User Feedback.studio" keeps a Decision's questions;
 * opening it fills Studio's form, and each run only needs its input.
 *
 * {
 *   "tool": "decision",
 *   "title": "Analyze User Feedback",
 *   "questions": { "sentiment": { "type": "choice", "instructions": "…",
 *     "criteria": ["positive", "neutral", "negative"] } }
 * }
 *
 * The settings are memon_studio's (questions, voice, task, labels, …); the
 * input (text, path) is given each run, so it is never kept.
 */
export type MemonStudioAppSettings = Omit<
	MemonStudioRequest,
	"tool" | "text" | "path"
>;

export interface MemonStudioAppConfig {
	tool: MemonStudioToolId;
	title: string;
	settings: MemonStudioAppSettings;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const STRINGS = ["task", "voice", "instructions", "language", "size"] as const;
const NUMBERS = ["speed", "count", "duration", "threshold"] as const;
const BOOLEANS = ["multiLabel", "translate"] as const;
const LISTS = ["labels", "documents"] as const;

/** Only the settings a studio run takes, each of its type. */
export const pickStudioAppSettings = (
	data: Record<string, unknown>,
): MemonStudioAppSettings => {
	const settings: MemonStudioAppSettings = {};
	for (const key of STRINGS) {
		const value = data[key];
		if (typeof value === "string" && value.trim()) settings[key] = value.trim();
	}
	for (const key of NUMBERS) {
		const value = data[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			settings[key] = value;
		}
	}
	for (const key of BOOLEANS) {
		if (typeof data[key] === "boolean") settings[key] = data[key] as boolean;
	}
	for (const key of LISTS) {
		const value = data[key];
		if (Array.isArray(value)) {
			const items = value
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter(Boolean);
			if (items.length) settings[key] = items;
		}
	}
	if (isRecord(data.questions) && Object.keys(data.questions).length) {
		settings.questions = data.questions;
	}
	return settings;
};

const isTool = (value: unknown): value is MemonStudioToolId =>
	typeof value === "string" && value in MEMON_STUDIO_LABELS;

/** The app's name from its file: "Analyze User Feedback.studio". */
export const studioAppTitleOf = (path: string): string =>
	(path.split("/").pop() ?? path).replace(/\.studio$/i, "") || "Studio app";

/** Reads a `.studio` file. Throws when it is not one. */
export const parseStudioAppFile = (
	content: string,
	path: string,
): MemonStudioAppConfig => {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (!isRecord(data) || !isTool(data.tool)) {
		throw new Error(
			`it needs "tool": one of ${Object.keys(MEMON_STUDIO_LABELS).join(", ")}`,
		);
	}
	return {
		tool: data.tool,
		title:
			typeof data.title === "string" && data.title.trim()
				? data.title.trim()
				: studioAppTitleOf(path),
		settings: pickStudioAppSettings(data),
	};
};

export const serializeStudioAppFile = (config: MemonStudioAppConfig): string =>
	`${JSON.stringify(
		{
			tool: config.tool,
			title: config.title,
			...pickStudioAppSettings(config.settings as Record<string, unknown>),
		},
		null,
		2,
	)}\n`;
