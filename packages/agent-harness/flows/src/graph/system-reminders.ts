import type { ChatCompletionMessageParam } from "../interfaces/engine/messages.js";

/**
 * Context that belongs to one moment of the conversation — the clock, the open
 * tasks, the page the user is on — kept out of the system prompt and out of
 * the user's own words.
 *
 * Prompt caching is a prefix match: the provider reuses a request only up to
 * the first byte that differs from one it already processed. So a reminder is
 * written into the conversation once, as its own message, at the point it was
 * first sent — and stays there. Every later request, in this run and in later
 * turns, carries it at the same position with the same bytes, so the
 * conversation only ever grows at the end.
 *
 * The trap is moving it. Reminders used to be re-attached past the end of each
 * request instead: the one sent after the user's message was gone from the
 * next request, which had the tool round-trip where it used to be and the
 * reminder behind that. Every request diverged from the previous one at the
 * reminder, and nothing past it could be read back. New context is attached
 * as a new reminder, after what came before; an old one is never removed or
 * rewritten.
 */

/**
 * The tag Claude Code wraps injected context in. Kept verbatim because models
 * read it as high-priority, out-of-band context rather than as something the
 * user typed.
 */
export const SYSTEM_REMINDER_TAG = "system-reminder" as const;

const OPEN_TAG = `<${SYSTEM_REMINDER_TAG}>`;
const CLOSE_TAG = `</${SYSTEM_REMINDER_TAG}>`;
const BLOCK_PATTERN = new RegExp(
	`${OPEN_TAG}\\n([\\s\\S]*?)\\n${CLOSE_TAG}`,
	"g",
);

/** Accumulate reminder blocks, dropping blanks and exact repeats. */
export const mergeReminders = (
	current: string[] | undefined,
	next: string[] | undefined,
): string[] => {
	if (next === undefined) return current ?? [];
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const block of [...(current ?? []), ...next]) {
		const trimmed = typeof block === "string" ? block.trim() : "";
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		merged.push(trimmed);
	}
	return merged;
};

const textOf = (content: ChatCompletionMessageParam["content"]): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n");
};

/** Reminder blocks as the model reads them: each in its own tag. */
export const formatSystemReminders = (blocks: string[]): string =>
	blocks.map((block) => `${OPEN_TAG}\n${block}\n${CLOSE_TAG}`).join("\n\n");

/** A message the run attached as reminders, not something the user wrote. */
export const isSystemReminderMessage = (
	message: Pick<ChatCompletionMessageParam, "role" | "content"> | undefined,
): boolean =>
	message?.role === "user" &&
	textOf(message.content).trimStart().startsWith(OPEN_TAG);

/** Every block the given messages already attached. */
export const remindersSentIn = (
	messages: readonly ChatCompletionMessageParam[],
): Set<string> => {
	const sent = new Set<string>();
	for (const message of messages) {
		if (!isSystemReminderMessage(message)) continue;
		for (const match of textOf(message.content).matchAll(BLOCK_PATTERN)) {
			const block = match[1]?.trim();
			if (block) sent.add(block);
		}
	}
	return sent;
};

/**
 * The message that attaches whichever reminders `sentIn` has not, or nothing.
 *
 * One message rather than one per block, so the reminders a request adds take
 * a single position in the provider's 20-position cache lookback no matter how
 * many steps contributed. Undefined when every block is already there, so a
 * request without new context sends exactly the bytes it would have without
 * reminders at all.
 */
export const systemReminderMessage = (
	reminders: string[] | undefined,
	sentIn: readonly ChatCompletionMessageParam[] = [],
): { role: "user"; content: string } | undefined => {
	const sent = remindersSentIn(sentIn);
	const blocks = mergeReminders([], reminders).filter(
		(block) => !sent.has(block),
	);
	if (blocks.length === 0) return undefined;
	return { role: "user", content: formatSystemReminders(blocks) };
};

/**
 * One request's reminders, attached after its conversation.
 *
 * For a run that sends a single request: the reminders land right after the
 * newest message, which is where they stay. Whoever stores the reply has to
 * keep that message in it (the `system-reminder` event carries it) so the next
 * turn's history repeats it in place. Returns `messages` untouched when there
 * is nothing to attach.
 */
export const withSystemReminders = (
	messages: ChatCompletionMessageParam[],
	reminders: string[] | undefined,
): ChatCompletionMessageParam[] => {
	const message = systemReminderMessage(reminders);
	return message ? [...messages, message] : messages;
};

/**
 * What a run reports when it attaches reminders, so the reply that is stored
 * keeps them where the model read them.
 */
export const SYSTEM_REMINDER_EVENT = "system-reminder" as const;

export interface SystemReminderEvent {
	type: typeof SYSTEM_REMINDER_EVENT;
	/** The message's content, byte for byte as the model read it. */
	content: string;
}
