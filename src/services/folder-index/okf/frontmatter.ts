import { parse, stringify } from "yaml";

/**
 * OKF documents: a YAML frontmatter block between `---` lines, then markdown
 * (OKF §4). Unknown keys are kept as they are, since consumers must preserve
 * them when round-tripping (§4.1).
 */

export type OkfFrontmatter = Record<string, unknown>;

export interface OkfDocument {
	frontmatter: OkfFrontmatter;
	body: string;
}

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a document; one without a readable frontmatter block has none. */
export const parseOkfDocument = (text: string): OkfDocument => {
	const match = FRONTMATTER.exec(text);
	if (!match) return { frontmatter: {}, body: text };
	let frontmatter: OkfFrontmatter = {};
	try {
		const parsed = parse(match[1]) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			frontmatter = parsed as OkfFrontmatter;
		}
	} catch {
		return { frontmatter: {}, body: text };
	}
	return { frontmatter, body: text.slice(match[0].length) };
};

/** The document text; keys with undefined values are left out. */
export const serializeOkfDocument = ({
	frontmatter,
	body,
}: OkfDocument): string => {
	const clean = Object.fromEntries(
		Object.entries(frontmatter).filter(([, value]) => value !== undefined),
	);
	const yaml = stringify(clean, { lineWidth: 0 }).trimEnd();
	const content = body.replace(/^\s*\n/, "").trimEnd();
	return `---\n${yaml}\n---\n${content ? `\n${content}\n` : ""}`;
};

export const frontmatterString = (
	frontmatter: OkfFrontmatter,
	key: string,
): string | undefined => {
	const value = frontmatter[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const frontmatterTags = (frontmatter: OkfFrontmatter): string[] => {
	const value = frontmatter.tags;
	if (Array.isArray(value)) {
		return value
			.filter(
				(tag): tag is string => typeof tag === "string" && tag.trim() !== "",
			)
			.map((tag) => tag.trim());
	}
	return typeof value === "string" && value.trim() ? [value.trim()] : [];
};

/** `verified` as a list: a bare `{ by, at }` mapping counts as one entry (§5.2). */
export const verificationEvents = (
	frontmatter: OkfFrontmatter,
): Array<{ by: string; at?: string }> => {
	const value = frontmatter.verified;
	const list = Array.isArray(value) ? value : value ? [value] : [];
	return list.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const { by, at } = entry as { by?: unknown; at?: unknown };
		return typeof by === "string"
			? [{ by, ...(typeof at === "string" ? { at } : {}) }]
			: [];
	});
};

export type OkfTrustTier =
	| "unverified"
	| "machine-confirmed"
	| "human-reviewed";

/** The trust tier OKF derives from `verified` (§5.3). */
export const trustTier = (frontmatter: OkfFrontmatter): OkfTrustTier => {
	const events = verificationEvents(frontmatter);
	if (!events.length) return "unverified";
	return events.some((event) => event.by.startsWith("human:"))
		? "human-reviewed"
		: "machine-confirmed";
};

/** `stable` unless the concept says otherwise (§5.4). */
export const lifecycleStatus = (frontmatter: OkfFrontmatter): string =>
	frontmatterString(frontmatter, "status") ?? "stable";

/** Whether `stale_after` has passed (§5.5). */
export const isStale = (
	frontmatter: OkfFrontmatter,
	now = new Date(),
): boolean => {
	const value = frontmatter.stale_after;
	const at =
		value instanceof Date
			? value
			: typeof value === "string"
				? new Date(value)
				: null;
	return Boolean(at && !Number.isNaN(at.getTime()) && now >= at);
};
