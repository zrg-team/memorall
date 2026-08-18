/**
 * Form values for OpenUI blocks, held outside the React tree that renders them.
 *
 * A message's OpenUI tree is unmounted twice over: `DeferredMount` drops it once
 * it is ~1.5 viewports off-screen, and collapsing a message group drops the whole
 * group. The DSL `Renderer` owns form state internally, so either unmount reset
 * every checkbox, input and select to its default. The fix is not to stop
 * unmounting — that unmounting is what keeps a long conversation from holding
 * dozens of live iframes and OpenUI trees — but to keep the values somewhere the
 * unmount cannot reach.
 *
 * Performance is why this is a plain module-level Map rather than a store or a
 * context:
 *
 * - Writes happen on every keystroke. A Map.set costs nothing and, crucially,
 *   notifies nobody: no subscriber, no re-render, no message list churn. Putting
 *   this in React state or a zustand store would re-render on every character.
 * - Reads happen once per mount.
 * - Nothing here runs on scroll, and nothing runs for messages that are not
 *   being mounted.
 */

/** Enough for any realistic conversation; oldest entries go first. */
const MAX_TRACKED_BLOCKS = 240;

/** How much of the content is fingerprinted from each end. */
const FINGERPRINT_WINDOW = 512;

const store = new Map<string, Record<string, unknown>>();

/**
 * A key for one OpenUI block.
 *
 * Deliberately does not hash the whole document. `OpenUIRenderer` budgets for
 * content up to 256KB, and hashing that on every mount would cost more than the
 * render it is protecting. Length plus both ends is O(1) and, combined with the
 * block's position in the message, distinguishes blocks that differ at all in
 * shape — two blocks would have to be the same length, share 1KB of head and
 * tail, and sit at the same index to collide.
 */
export const openUIStateKey = (
	positionKey: string,
	content: string,
): string => {
	const head = content.slice(0, FINGERPRINT_WINDOW);
	const tail =
		content.length > FINGERPRINT_WINDOW
			? content.slice(-FINGERPRINT_WINDOW)
			: "";
	return `${positionKey}:${content.length}:${head}${tail}`;
};

export const readOpenUIState = (
	key: string,
): Record<string, unknown> | undefined => store.get(key);

export const writeOpenUIState = (
	key: string,
	state: Record<string, unknown>,
): void => {
	// Re-inserting moves the entry to the back, so eviction stays least-recently-used.
	if (store.delete(key)) {
		store.set(key, state);
		return;
	}
	store.set(key, state);
	if (store.size > MAX_TRACKED_BLOCKS) {
		const oldest = store.keys().next();
		if (!oldest.done) store.delete(oldest.value);
	}
};

/** Test seam, and a hook for clearing on conversation switch. */
export const clearOpenUIState = (): void => store.clear();

export const openUIStateSize = (): number => store.size;
