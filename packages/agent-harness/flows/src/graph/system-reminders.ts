import type { ChatCompletionMessageParam } from "../interfaces/engine/messages.js";

/**
 * Volatile context, attached past the end of the conversation prefix.
 *
 * Prompt caching is a prefix match: the provider reuses a request only up to
 * the first byte that differs from one it already processed. So anything that
 * changes request to request — the clock, retrieved knowledge, per-turn state —
 * has to live after everything that doesn't, and it must never be written into
 * a position that a later request reaches *through*. Editing an existing
 * message is the trap: it looks local, but the next turn rebuilds that message
 * without the edit, the prefix diverges there, and every token behind it —
 * an entire tool loop, often hundreds of thousands of them — is re-read at full
 * price.
 *
 * Reminders avoid that by never entering the conversation at all. They live in
 * their own state channel and are re-attached to the tail of each request, so
 * `messages` only ever grows at the end and the cached prefix keeps matching.
 */

/**
 * The tag Claude Code wraps injected context in. Kept verbatim because models
 * read it as high-priority, out-of-band context rather than as something the
 * user typed.
 */
export const SYSTEM_REMINDER_TAG = "system-reminder" as const;

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

/**
 * Append this run's reminders to a request, as one trailing user message.
 *
 * One message rather than one per block, so the tail stays a single position in
 * the provider's 20-position cache lookback no matter how many steps
 * contributed. Returns `messages` untouched when there is nothing to attach, so
 * a run without reminders sends exactly the bytes it sent before.
 */
export const withSystemReminders = (
	messages: ChatCompletionMessageParam[],
	reminders: string[] | undefined,
): ChatCompletionMessageParam[] => {
	const blocks = mergeReminders([], reminders);
	if (blocks.length === 0) return messages;
	const content = blocks
		.map(
			(block) =>
				`<${SYSTEM_REMINDER_TAG}>\n${block}\n</${SYSTEM_REMINDER_TAG}>`,
		)
		.join("\n\n");
	return [...messages, { role: "user", content }];
};
