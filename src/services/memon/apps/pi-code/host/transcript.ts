/**
 * pi's conversation as the Memon agent reads it on the screen: one entry per
 * prompt, answer, tool call and ! command, with long text clipped. The last
 * answer keeps the most, since that is what the agent reports on.
 */
import type { MemonPiCodeEntry } from "../../../types";
import type { AgentMessage } from "../agent";

/** Entries the screen can show; older ones are counted, not kept. */
export const TRANSCRIPT_ENTRIES = 40;
const TEXT_CHARS = 400;
const LAST_ANSWER_CHARS = 2_000;
const TARGET_CHARS = 120;
const RESULT_CHARS = 160;

const clip = (text: string, max: number): string => {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

const firstLine = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean) ?? "";

const lastLine = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1) ?? "";

const textOf = (
	content: string | ReadonlyArray<{ type: string; text?: string }>,
): string =>
	typeof content === "string"
		? content
		: content
				.filter((part) => part.type === "text")
				.map((part) => part.text ?? "")
				.join("\n");

/** What a tool call works on: its command, or its pattern and path. */
const toolTarget = (args: Record<string, unknown>): string => {
	if (typeof args.command === "string") return clip(args.command, TARGET_CHARS);
	const parts = [args.pattern, args.path].filter(
		(value): value is string => typeof value === "string" && Boolean(value),
	);
	return clip(parts.join(" in "), TARGET_CHARS);
};

/** How pi's last turn ended: it answered (or asked), failed, or was stopped. */
export type PiTurnEnd = "done" | "error" | "stopped";

export interface Transcript {
	entries: MemonPiCodeEntry[];
	/** Entries before `entries` that were left out. */
	earlier: number;
	/** How the last turn ended, read once pi is idle; unset before the first. */
	ended?: PiTurnEnd;
	/** The last reply's text, clipped as the screen shows it; unset when it had none. */
	reply?: string;
}

/**
 * The conversation, with the reply still streaming (if any) last. Tool
 * results fold into their call's entry: failed or not, and their first line.
 */
export const buildTranscript = (
	messages: readonly AgentMessage[],
	streaming?: AgentMessage,
	limit = TRANSCRIPT_ENTRIES,
): Transcript => {
	const entries: MemonPiCodeEntry[] = [];
	const calls = new Map<string, MemonPiCodeEntry>();
	let lastAnswer: { entry: MemonPiCodeEntry; text: string } | undefined;
	let ended: PiTurnEnd | undefined;
	/** The latest reply's own text: empty when it only called tools. */
	let replied = "";

	const add = (message: AgentMessage) => {
		switch (message.role) {
			case "user": {
				const text = textOf(message.content);
				if (text.trim())
					entries.push({ kind: "user", text: clip(text, TEXT_CHARS) });
				return;
			}
			case "assistant": {
				const text = textOf(message.content);
				if (text.trim()) {
					const entry: MemonPiCodeEntry = {
						kind: "assistant",
						text: clip(text, TEXT_CHARS),
					};
					entries.push(entry);
					lastAnswer = { entry, text };
				}
				for (const part of message.content) {
					if (part.type !== "toolCall") continue;
					const entry: MemonPiCodeEntry = {
						kind: "tool",
						name: part.name,
						text: toolTarget(part.arguments ?? {}),
					};
					entries.push(entry);
					calls.set(part.id, entry);
				}
				if (message.stopReason === "error") {
					entries.push({
						kind: "error",
						text: clip(message.errorMessage || "error", TEXT_CHARS),
					});
				} else if (message.stopReason === "aborted") {
					entries.push({ kind: "error", text: "stopped" });
				}
				replied = text;
				ended =
					message.stopReason === "error"
						? "error"
						: message.stopReason === "aborted"
							? "stopped"
							: "done";
				return;
			}
			case "toolResult": {
				const entry = calls.get(message.toolCallId);
				if (!entry) return;
				const result = clip(firstLine(textOf(message.content)), RESULT_CHARS);
				entry.failed = message.isError || undefined;
				if (result)
					entry.text = entry.text ? `${entry.text} → ${result}` : result;
				return;
			}
			case "bashExecution": {
				const failed =
					message.cancelled ||
					(message.exitCode !== undefined && message.exitCode !== 0);
				const outcome = message.cancelled
					? "cancelled"
					: message.exitCode === undefined
						? ""
						: `exit ${message.exitCode}`;
				const output = clip(lastLine(message.output), RESULT_CHARS);
				entries.push({
					kind: "bash",
					text: [clip(message.command, TARGET_CHARS), outcome, output]
						.filter(Boolean)
						.join(" → "),
					failed: failed || undefined,
				});
				return;
			}
			case "compactionSummary":
				entries.push({
					kind: "summary",
					text: `earlier conversation compacted: ${clip(message.summary, TEXT_CHARS)}`,
				});
				return;
			case "branchSummary":
				entries.push({
					kind: "summary",
					text: clip(message.summary, TEXT_CHARS),
				});
				return;
			case "custom":
				if (message.display) {
					const text = textOf(message.content);
					if (text.trim())
						entries.push({ kind: "summary", text: clip(text, TEXT_CHARS) });
				}
				return;
		}
	};

	for (const message of messages) add(message);
	// A reply still streaming has not ended the turn.
	const settled = { ended, reply: replied.trim() ? replied : undefined };
	if (streaming) add(streaming);
	if (lastAnswer)
		lastAnswer.entry.text = clip(lastAnswer.text, LAST_ANSWER_CHARS);

	const earlier = Math.max(0, entries.length - limit);
	return {
		entries: entries.slice(earlier),
		earlier,
		ended: settled.ended,
		reply: settled.reply && clip(settled.reply, LAST_ANSWER_CHARS),
	};
};
