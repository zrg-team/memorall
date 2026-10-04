/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../../LICENSE).
 * Browser port: there is no ripgrep to spawn. The caller's GrepOperations.search
 * (a walk over the Memon file system) yields the matches rg --json would,
 * and pi's formatting, context lines and truncation below are unchanged.
 */
import type { AgentTool } from "@/services/memon/apps/pi-code/agent";
import { Text } from "@/services/memon/apps/pi-code/tui";
import { type Static, Type } from "@/services/memon/apps/pi-code/ai/schema";
import path from "../../../platform/path";
import { keyHint } from "../../modes/interactive/components/keybinding-hints";
import type {
	ToolDefinition,
	ToolRenderResultOptions,
} from "../extensions/types";
import { resolveToCwd } from "./path-utils";
import {
	getTextOutput,
	invalidArgText,
	shortenPath,
	str,
} from "./render-utils";
import { wrapToolDefinition } from "./tool-definition-wrapper";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "./truncate";

const grepSchema = Type.Object({
	pattern: Type.String({
		description: "Search pattern (regex or literal string)",
	}),
	path: Type.Optional(
		Type.String({
			description: "Directory or file to search (default: current directory)",
		}),
	),
	glob: Type.Optional(
		Type.String({
			description:
				"Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
		}),
	),
	ignoreCase: Type.Optional(
		Type.Boolean({ description: "Case-insensitive search (default: false)" }),
	),
	literal: Type.Optional(
		Type.Boolean({
			description:
				"Treat pattern as literal string instead of regex (default: false)",
		}),
	),
	context: Type.Optional(
		Type.Number({
			description:
				"Number of lines to show before and after each match (default: 0)",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum number of matches to return (default: 100)",
		}),
	),
});

export type GrepToolInput = Static<typeof grepSchema>;
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

/**
 * Pluggable operations for the grep tool.
 * Override these to delegate search to remote systems (for example SSH).
 */
export interface GrepOperations {
	/** Check if path is a directory. Throws if path does not exist. */
	isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	/** Read file contents for context lines */
	readFile: (absolutePath: string) => Promise<string> | string;
	/**
	 * Find matching lines (stands in for `rg --json --line-number --hidden`):
	 * respects .gitignore, includes dotfiles, stops after `limit` matches.
	 */
	search: (options: GrepSearchOptions) => Promise<GrepSearchResult>;
}

export interface GrepSearchOptions {
	pattern: string;
	/** Absolute file or directory to search. */
	path: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	limit: number;
	signal?: AbortSignal;
}

export interface GrepSearchResult {
	matches: Array<{ filePath: string; lineNumber: number; lineText?: string }>;
	/** True when the search stopped at `limit`. */
	limitReached: boolean;
}

const unavailable = () =>
	Promise.reject(new Error("No file system is available to search."));
const defaultGrepOperations: GrepOperations = {
	isDirectory: unavailable,
	readFile: unavailable,
	search: unavailable,
};

export interface GrepToolOptions {
	/** Operations for grep (the Memon file system). */
	operations?: GrepOperations;
	/** Home directory "~" expands to. */
	home?: string;
}

function formatGrepCall(
	args:
		| { pattern: string; path?: string; glob?: string; limit?: number }
		| undefined,
	theme: typeof import("../../modes/interactive/theme/theme").theme,
): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const glob = str(args?.glob);
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("grep")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
		theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
	if (glob) text += theme.fg("toolOutput", ` (${glob})`);
	if (limit !== undefined) text += theme.fg("toolOutput", ` limit ${limit}`);
	return text;
}

function formatGrepResult(
	result: {
		content: Array<{
			type: string;
			text?: string;
			data?: string;
			mimeType?: string;
		}>;
		details?: GrepToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme").theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 15;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
		}
	}

	const matchLimit = result.details?.matchLimitReached;
	const truncation = result.details?.truncation;
	const linesTruncated = result.details?.linesTruncated;
	if (matchLimit || truncation?.truncated || linesTruncated) {
		const warnings: string[] = [];
		if (matchLimit) warnings.push(`${matchLimit} matches limit`);
		if (truncation?.truncated)
			warnings.push(
				`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`,
			);
		if (linesTruncated) warnings.push("some lines truncated");
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export function createGrepToolDefinition(
	cwd: string,
	options?: GrepToolOptions,
): ToolDefinition<typeof grepSchema, GrepToolDetails | undefined> {
	const customOps = options?.operations;
	return {
		name: "grep",
		label: "grep",
		description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		promptSnippet: "Search file contents for patterns (respects .gitignore)",
		parameters: grepSchema,
		async execute(
			_toolCallId,
			{
				pattern,
				path: searchDir,
				glob,
				ignoreCase,
				literal,
				context,
				limit,
			}: {
				pattern: string;
				path?: string;
				glob?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			},
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			return new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				let settled = false;
				const settle = (fn: () => void) => {
					if (!settled) {
						settled = true;
						fn();
					}
				};

				(async () => {
					try {
						const searchPath = resolveToCwd(
							searchDir || ".",
							cwd,
							options?.home,
						);
						const ops = customOps ?? defaultGrepOperations;
						let isDirectory: boolean;
						try {
							isDirectory = await ops.isDirectory(searchPath);
						} catch {
							settle(() => reject(new Error(`Path not found: ${searchPath}`)));
							return;
						}

						const contextValue = context && context > 0 ? context : 0;
						const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
						const formatPath = (filePath: string): string => {
							if (isDirectory) {
								const relative = path.relative(searchPath, filePath);
								if (relative && !relative.startsWith("..")) {
									return relative.replace(/\\/g, "/");
								}
							}
							return path.basename(filePath);
						};

						const fileCache = new Map<string, string[]>();
						const getFileLines = async (
							filePath: string,
						): Promise<string[]> => {
							let lines = fileCache.get(filePath);
							if (!lines) {
								try {
									const content = await ops.readFile(filePath);
									lines = content
										.replace(/\r\n/g, "\n")
										.replace(/\r/g, "\n")
										.split("\n");
								} catch {
									lines = [];
								}
								fileCache.set(filePath, lines);
							}
							return lines;
						};

						let matchLimitReached = false;
						let linesTruncated = false;
						const outputLines: string[] = [];

						const formatBlock = async (
							filePath: string,
							lineNumber: number,
						): Promise<string[]> => {
							const relativePath = formatPath(filePath);
							const lines = await getFileLines(filePath);
							if (!lines.length)
								return [`${relativePath}:${lineNumber}: (unable to read file)`];
							const block: string[] = [];
							const start =
								contextValue > 0
									? Math.max(1, lineNumber - contextValue)
									: lineNumber;
							const end =
								contextValue > 0
									? Math.min(lines.length, lineNumber + contextValue)
									: lineNumber;
							for (let current = start; current <= end; current++) {
								const lineText = lines[current - 1] ?? "";
								const sanitized = lineText.replace(/\r/g, "");
								const isMatchLine = current === lineNumber;
								// Truncate long lines so grep output stays compact.
								const { text: truncatedText, wasTruncated } =
									truncateLine(sanitized);
								if (wasTruncated) linesTruncated = true;
								if (isMatchLine)
									block.push(`${relativePath}:${current}: ${truncatedText}`);
								else block.push(`${relativePath}-${current}- ${truncatedText}`);
							}
							return block;
						};

						const found = await ops.search({
							pattern,
							path: searchPath,
							glob,
							ignoreCase,
							literal,
							limit: effectiveLimit,
							signal,
						});
						if (signal?.aborted) {
							settle(() => reject(new Error("Operation aborted")));
							return;
						}
						const matches = found.matches.slice(0, effectiveLimit);
						const matchCount = matches.length;
						matchLimitReached =
							found.limitReached || matchCount >= effectiveLimit;
						{
							if (matchCount === 0) {
								settle(() =>
									resolve({
										content: [{ type: "text", text: "No matches found" }],
										details: undefined,
									}),
								);
								return;
							}

							// Format matches after streaming finishes so custom readFile() backends can be async.
							for (const match of matches) {
								if (contextValue === 0 && match.lineText !== undefined) {
									const relativePath = formatPath(match.filePath);
									const sanitized = match.lineText
										.replace(/\r\n/g, "\n")
										.replace(/\r/g, "")
										.replace(/\n$/, "");
									const { text: truncatedText, wasTruncated } =
										truncateLine(sanitized);
									if (wasTruncated) linesTruncated = true;
									outputLines.push(
										`${relativePath}:${match.lineNumber}: ${truncatedText}`,
									);
								} else {
									const block = await formatBlock(
										match.filePath,
										match.lineNumber,
									);
									outputLines.push(...block);
								}
							}

							const rawOutput = outputLines.join("\n");
							// Apply byte truncation. There is no line limit here because the match limit already capped rows.
							const truncation = truncateHead(rawOutput, {
								maxLines: Number.MAX_SAFE_INTEGER,
							});
							let output = truncation.content;
							const details: GrepToolDetails = {};
							// Build actionable notices for truncation and match limits.
							const notices: string[] = [];
							if (matchLimitReached) {
								notices.push(
									`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
								);
								details.matchLimitReached = effectiveLimit;
							}
							if (truncation.truncated) {
								notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
								details.truncation = truncation;
							}
							if (linesTruncated) {
								notices.push(
									`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
								);
								details.linesTruncated = true;
							}
							if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
							settle(() =>
								resolve({
									content: [{ type: "text", text: output }],
									details:
										Object.keys(details).length > 0 ? details : undefined,
								}),
							);
						}
					} catch (err) {
						settle(() => reject(err as Error));
					}
				})();
			});
		},
		renderCall(args, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatGrepCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				formatGrepResult(result as any, options, theme, context.showImages),
			);
			return text;
		},
	};
}

export function createGrepTool(
	cwd: string,
	options?: GrepToolOptions,
): AgentTool<typeof grepSchema> {
	return wrapToolDefinition(createGrepToolDefinition(cwd, options));
}
