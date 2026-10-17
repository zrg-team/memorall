/** Chrome takes at most two captures a second, for the whole extension. */
const CAPTURE_INTERVAL_MS = 550;

let lastCaptureAt = 0;
let captureQueue: Promise<unknown> = Promise.resolve();

/**
 * Waits for a capture's turn. Every `captureVisibleTab` of the background
 * goes through here, one after another and spaced out, since one over
 * Chrome's quota fails rather than waits: a screenshot taken right after a
 * whole page (or the co-agent's, at the same time) would otherwise fail.
 */
export const nextCaptureSlot = (): Promise<void> => {
	const slot = captureQueue.then(async () => {
		const wait = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastCaptureAt = Date.now();
	});
	captureQueue = slot.catch(() => undefined);
	return slot;
};
