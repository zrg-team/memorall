/**
 * Writing down a co-agent turn the way it was actually sent.
 *
 * A turn with something attached reaches the model as content parts — the
 * words plus an image. The transcript used to record only `content`, the bare
 * text, so a captured region was sent, answered about, and then invisible: the
 * reader saw a question about a picture that appeared nowhere.
 */

export interface StoredTurn {
	content: string;
	/** Present only when the turn carried more than text. */
	complexContent?: unknown[];
}

/**
 * @param prompt what the user typed, which stays the searchable text
 * @param sent the turn as handed to the model: a string, or content parts
 */
export const buildStoredTurn = (prompt: string, sent: unknown): StoredTurn =>
	Array.isArray(sent) && sent.length > 0
		? { content: prompt, complexContent: sent }
		: { content: prompt };
