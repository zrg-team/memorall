/**
 * Keeping an assistant reply once the user has seen it.
 *
 * The reply used to reach the database in one write at the very end of the
 * run. When that write failed, or the run never got there (the extension
 * reloaded, the offscreen document was recycled), the user had watched the
 * answer stream in and then found an empty message after a reload. So the
 * run saves as it goes, and a final write that fails falls back to smaller
 * forms of the same reply instead of giving up.
 */

/** How long a tool's output may be in the compact fallback. */
const COMPACT_TOOL_OUTPUT_CHARS = 4_000;
/** How often a running reply is saved, at most. */
export const CHECKPOINT_INTERVAL_MS = 4_000;

type MessagePart = Record<string, unknown>;

export interface StoredReply<TParts, TMetadata> {
	content: string;
	parts: TParts | null;
	metadata: TMetadata;
}

const truncate = (text: string, max: number): string =>
	text.length > max
		? `${text.slice(0, max)}\n… [${text.length - max} more characters not kept]`
		: text;

/** The reply's steps with every tool output cut down to a readable size. */
export const compactParts = <TParts>(parts: TParts | null): TParts | null => {
	if (!Array.isArray(parts)) return parts;
	return parts.map((part: MessagePart) =>
		part?.role === "tool" && typeof part.content === "string"
			? {
					...part,
					content: truncate(part.content, COMPACT_TOOL_OUTPUT_CHARS),
				}
			: part,
	) as TParts;
};

/** What the assistant said, without its steps. */
export const textFromParts = (parts: unknown): string => {
	if (!Array.isArray(parts)) return "";
	return parts
		.filter(
			(part: MessagePart) =>
				part?.role === "assistant" &&
				typeof part.content === "string" &&
				part.content.trim(),
		)
		.map((part: MessagePart) => part.content as string)
		.join("\n\n");
};

export type StoredReplyForm = "full" | "compact" | "text";

/**
 * Writes the reply, and if that fails, smaller versions of it: tool outputs
 * cut short, then only what the assistant said. Resolves to the form that
 * was kept (with why the full one was not), or throws the first error when
 * none could be.
 */
export const persistReplyWithFallback = async <
	TParts,
	TMetadata extends Record<string, unknown>,
>(
	reply: StoredReply<TParts, TMetadata>,
	write: (reply: StoredReply<TParts, TMetadata>) => Promise<void>,
	minimalMetadata: (metadata: TMetadata) => TMetadata,
): Promise<{ form: StoredReplyForm; fullError?: unknown }> => {
	const forms: Array<[StoredReplyForm, StoredReply<TParts, TMetadata>]> = [
		["full", reply],
		["compact", { ...reply, parts: compactParts(reply.parts) }],
		[
			"text",
			{
				content: reply.content || textFromParts(reply.parts),
				parts: null,
				metadata: minimalMetadata(reply.metadata),
			},
		],
	];

	let firstError: unknown;
	for (const [form, candidate] of forms) {
		try {
			await write(candidate);
			return firstError === undefined
				? { form }
				: { form, fullError: firstError };
		} catch (error) {
			firstError ??= error;
		}
	}
	throw firstError;
};

/**
 * Saves a running reply every few seconds while it changes, one write at a
 * time. `stop` waits for a write in flight, so the final save is never
 * overtaken by an older checkpoint.
 */
export const createReplyCheckpointer = ({
	snapshot,
	intervalMs = CHECKPOINT_INTERVAL_MS,
	onError,
}: {
	/** The reply as it stands, and a cheap key that changes when it does. */
	snapshot: () => { key: string; save: () => Promise<void> } | null;
	intervalMs?: number;
	onError?: (error: unknown) => void;
}) => {
	let timer: ReturnType<typeof setInterval> | null = null;
	let inFlight: Promise<void> | null = null;
	let lastKey = "";
	let stopped = false;

	const tick = () => {
		if (stopped || inFlight) return;
		const current = snapshot();
		if (!current || current.key === lastKey) return;
		lastKey = current.key;
		inFlight = current
			.save()
			.catch((error) => onError?.(error))
			.finally(() => {
				inFlight = null;
			});
	};

	return {
		start: () => {
			if (timer || stopped) return;
			timer = setInterval(tick, intervalMs);
		},
		stop: async () => {
			stopped = true;
			if (timer) clearInterval(timer);
			timer = null;
			await inFlight;
		},
	};
};
