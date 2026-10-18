/**
 * Validating the arguments a model sent, and saying something useful when they
 * are wrong.
 *
 * Two things go wrong often enough to be worth handling here rather than in
 * every tool.
 *
 * **An empty string where the model meant "not applicable".** Models fill in
 * every documented field, so an optional `z.string().min(1)` gets `""` and the
 * whole call is rejected — including calls that are otherwise complete. Real
 * example: `web_find_in_page` takes `pattern` plus a deprecated `query` alias,
 * and `{pattern: "rent", query: ""}` failed validation despite saying exactly
 * what it wanted. An empty string is not an argument; drop it and try again.
 *
 * The drop is deliberately narrow: a key is removed only when the schema itself
 * complained that it was too short or an invalid URL, so a call that already
 * validates is never touched, and a tool that genuinely accepts `""` (a file's
 * contents, a process's stdin) keeps it, because no such complaint is raised.
 *
 * **A ZodError reaching the model as JSON.** `ZodError.message` is the
 * pretty-printed issue array, so a failed call arrives in the transcript as
 * twenty lines of `{"code": "too_small", "inclusive": true, …}` — which tells
 * the reader the tool is broken and tells the model nothing it can act on.
 * Render the issues as a short list of what to fix instead.
 *
 * A required field the model left out is named as missing, not as invalid:
 * "object: Invalid input" read alongside advice to omit fields led models to
 * leave the same field out again on the retry.
 *
 * **A value in a near-miss shape.** `planner_check_item` got `item_id: 1` for
 * a string id; flags arrive as `"true"`, counts as `"3"`, one tag instead of a
 * list, an option as `"Preference"`. Where a value has exactly one sensible
 * reading it is read that way and the call retried; anything else is still
 * reported for the model to fix.
 */

import { z } from "zod";
import { isJsonToolSchema, type ToolSchema } from "./tool.js";

// Zod installs its English messages from a module it marks side-effect free,
// so production bundles drop that call and every issue reads just "Invalid
// input". Install them here, where the messages reach the model.
z.config(z.locales.en());

interface ZodLikeIssue {
	readonly code: string;
	readonly path: ReadonlyArray<PropertyKey>;
	readonly message: string;
	readonly minimum?: number | bigint;
	readonly origin?: string;
	readonly format?: string;
	/** invalid_type: the type the schema wanted. */
	readonly expected?: string;
	/** invalid_value: the options the schema accepts. */
	readonly values?: ReadonlyArray<unknown>;
}

interface ZodLikeError {
	readonly issues: ReadonlyArray<ZodLikeIssue>;
}

type ZodLikeSchema = {
	safeParse: (input: unknown) => {
		success: boolean;
		data?: unknown;
		error?: unknown;
	};
};

const isZodLikeSchema = (
	schema: ToolSchema,
): schema is ToolSchema & ZodLikeSchema =>
	!isJsonToolSchema(schema) &&
	typeof (schema as Partial<ZodLikeSchema>).safeParse === "function";

export const isZodLikeError = (value: unknown): value is ZodLikeError =>
	typeof value === "object" &&
	value !== null &&
	Array.isArray((value as { issues?: unknown }).issues);

/** `["filters", 0, "name"]` reads back as `filters[0].name`. */
const formatIssuePath = (path: ReadonlyArray<PropertyKey>): string => {
	if (path.length === 0) return "";
	return path.reduce<string>((rendered, segment) => {
		if (typeof segment === "number") return `${rendered}[${segment}]`;
		return rendered ? `${rendered}.${String(segment)}` : String(segment);
	}, "");
};

/** Whether `path` names a key the arguments do not have at all. */
const isMissingAt = (
	input: unknown,
	path: ReadonlyArray<PropertyKey>,
): boolean => {
	const key = path.at(-1);
	if (key === undefined) return false;
	let container: unknown = input;
	for (const segment of path.slice(0, -1)) {
		if (typeof container !== "object" || container === null) return false;
		container = (container as Record<PropertyKey, unknown>)[segment];
	}
	if (typeof container !== "object" || container === null) return false;
	return (container as Record<PropertyKey, unknown>)[key] === undefined;
};

/**
 * A short, actionable rendering of what the schema rejected.
 *
 * One line per issue, deduplicated: Zod reports both the field-level failure
 * and any object-level refine that failed because of it, and the model does not
 * need to be told twice. Pass the arguments that were validated so a field the
 * model left out is reported as missing rather than as a wrong value.
 */
export const describeSchemaIssues = (
	error: unknown,
	toolName?: string,
	input?: unknown,
): string => {
	if (!isZodLikeError(error)) {
		return error instanceof Error ? error.message : String(error);
	}

	const seen = new Set<string>();
	const lines: string[] = [];
	for (const issue of error.issues) {
		const path = formatIssuePath(issue.path);
		const message =
			issue.code === "invalid_type" && isMissingAt(input, issue.path)
				? "required, but missing"
				: issue.message;
		const line = path ? `- ${path}: ${message}` : `- ${message}`;
		if (seen.has(line)) continue;
		seen.add(line);
		lines.push(line);
	}

	const subject = toolName ? `\`${toolName}\`` : "This tool";
	return [
		`${subject} rejected the arguments:`,
		...lines,
		"",
		"Fix those fields and call it again. Every required field needs a value; leave out an optional field you have no value for rather than passing an empty string.",
	].join("\n");
};

const isBlankString = (value: unknown): boolean =>
	typeof value === "string" && value.trim().length === 0;

/**
 * The top-level keys whose only problem is that the model sent `""`.
 *
 * Nested paths are left alone: removing a key from inside an object the tool
 * expects to be shaped a certain way is a guess, while a top-level argument the
 * schema calls too short or an invalid URL is simply absent.
 */
const blankKeysToDrop = (
	error: unknown,
	input: Record<string, unknown>,
): string[] => {
	if (!isZodLikeError(error)) return [];

	const keys: string[] = [];
	for (const issue of error.issues) {
		if (
			issue.code !== "too_small" &&
			!(issue.code === "invalid_format" && issue.format === "url")
		)
			continue;
		if (issue.path.length !== 1) continue;
		const key = issue.path[0];
		if (typeof key !== "string") continue;
		if (!isBlankString(input[key])) continue;
		if (!keys.includes(key)) keys.push(key);
	}
	return keys;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** An option name as it is meant, whatever its case or separators. */
const optionKey = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");

/**
 * The one sensible reading of a value sent in a near-miss shape: `1` for a
 * string id, `"true"` for a flag, `"3"` for a count, one tag where a list was
 * wanted, `"Project Context"` for the option `project_context`. Null when
 * there is no single reading; the model is told to fix those itself.
 */
const nearMissValue = (
	issue: ZodLikeIssue,
	value: unknown,
): { value: unknown } | null => {
	if (issue.code === "invalid_type") {
		switch (issue.expected) {
			case "string":
				return typeof value === "number" || typeof value === "boolean"
					? { value: String(value) }
					: null;
			case "number": {
				if (typeof value !== "string" || !value.trim()) return null;
				const number = Number(value);
				return Number.isFinite(number) ? { value: number } : null;
			}
			case "boolean": {
				if (typeof value !== "string") return null;
				const text = value.trim().toLowerCase();
				if (text === "true") return { value: true };
				if (text === "false") return { value: false };
				return null;
			}
			case "array":
				return value === undefined || value === null || Array.isArray(value)
					? null
					: { value: [value] };
			default:
				return null;
		}
	}
	if (issue.code === "invalid_value" && typeof value === "string") {
		const wanted = optionKey(value);
		const matches = (issue.values ?? []).filter(
			(option) => typeof option === "string" && optionKey(option) === wanted,
		);
		return matches.length === 1 ? { value: matches[0] } : null;
	}
	return null;
};

const valueAt = (root: unknown, path: ReadonlyArray<PropertyKey>): unknown => {
	let value: unknown = root;
	for (const segment of path) {
		if (typeof value !== "object" || value === null) return undefined;
		value = (value as Record<PropertyKey, unknown>)[segment];
	}
	return value;
};

/**
 * The arguments with every near-miss value read the one way it can be read,
 * or null when no issue had such a reading. The input is not changed.
 */
const repairNearMisses = (
	error: unknown,
	input: Record<string, unknown>,
): Record<string, unknown> | null => {
	if (!isZodLikeError(error)) return null;
	let repaired: Record<string, unknown> | null = null;
	for (const issue of error.issues) {
		if (issue.path.length === 0) continue;
		const fixed = nearMissValue(issue, valueAt(repaired ?? input, issue.path));
		if (!fixed) continue;
		repaired ??= structuredClone(input);
		const parent = valueAt(repaired, issue.path.slice(0, -1));
		if (typeof parent !== "object" || parent === null) continue;
		(parent as Record<PropertyKey, unknown>)[
			issue.path[issue.path.length - 1] as PropertyKey
		] = fixed.value;
	}
	return repaired;
};

export class ToolInputError extends Error {
	readonly issues: ReadonlyArray<ZodLikeIssue>;

	constructor(message: string, issues: ReadonlyArray<ZodLikeIssue>) {
		super(message);
		this.name = "ToolInputError";
		this.issues = issues;
	}
}

export const parseToolInput = <T>(
	schema: ToolSchema,
	input: unknown,
	toolName?: string,
): T => {
	if (!isZodLikeSchema(schema)) {
		return schema.parse(input) as T;
	}

	const first = schema.safeParse(input);
	if (first.success) return first.data as T;

	if (isRecord(input)) {
		let retried: Record<string, unknown> | null = null;
		const drop = blankKeysToDrop(first.error, input);
		if (drop.length > 0) {
			retried = { ...input };
			for (const key of drop) delete retried[key];
		}
		retried = repairNearMisses(first.error, retried ?? input) ?? retried;
		if (retried) {
			const second = schema.safeParse(retried);
			if (second.success) return second.data as T;
			// Still invalid — report the retry's issues, which no longer mention
			// the empty fields and near misses the model can do nothing about.
			throw new ToolInputError(
				describeSchemaIssues(second.error, toolName, retried),
				isZodLikeError(second.error) ? second.error.issues : [],
			);
		}
	}

	throw new ToolInputError(
		describeSchemaIssues(first.error, toolName, input),
		isZodLikeError(first.error) ? first.error.issues : [],
	);
};

export type { ZodLikeIssue };
export type ZodSchemaLike = z.ZodTypeAny;
