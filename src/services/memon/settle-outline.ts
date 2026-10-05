import { formatPageOutline } from "@/co-agent/dom/page-outline";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";

/** How often a page that is still settling is read again. */
const POLL_MS = 200;
/** A page unchanged for this long is drawn. */
const QUIET_MS = 800;
/** A page with nothing on it gets longer: its scripts may not have run yet. */
const EMPTY_QUIET_MS = 3_000;

export interface SettleOutlineOptions {
	/** Gives up after this long and returns the last read, marked busy. */
	timeoutMs: number;
	pollMs?: number;
	quietMs?: number;
	emptyQuietMs?: number;
}

/** What the agent would read; any change to it means the page moved. */
const signatureOf = (outline: WebPageOutline): string =>
	[
		outline.url,
		outline.title,
		outline.docToken,
		formatPageOutline(outline),
	].join("\n");

const isEmpty = (outline: WebPageOutline): boolean =>
	outline.blocks.length === 0 &&
	outline.omittedAbove === 0 &&
	outline.omittedBelow === 0;

/**
 * Reads a page until it holds still. A page its own scripts draw (a
 * client-rendered app) is still an empty shell or a loading state when the
 * browser reports it loaded, so it is read again until it is not busy and
 * has not changed for a moment. When time runs out, the last read comes back
 * marked busy; a read that fails (the page is between documents) is retried.
 */
export const settleOutline = async (
	read: () => Promise<WebPageOutline>,
	{
		timeoutMs,
		pollMs = POLL_MS,
		quietMs = QUIET_MS,
		emptyQuietMs = EMPTY_QUIET_MS,
	}: SettleOutlineOptions,
): Promise<WebPageOutline> => {
	const deadline = Date.now() + timeoutMs;
	let last: WebPageOutline | undefined;
	let lastError: unknown;
	let signature: string | undefined;
	let quietSince = 0;
	while (true) {
		try {
			const outline = await read();
			const now = Date.now();
			const next = signatureOf(outline);
			if (next !== signature) {
				signature = next;
				quietSince = now;
			}
			last = outline;
			lastError = undefined;
			const needed = isEmpty(outline) ? emptyQuietMs : quietMs;
			if (!outline.busy && now - quietSince >= needed) return outline;
		} catch (error) {
			lastError = error;
			signature = undefined;
		}
		if (Date.now() >= deadline) {
			if (last) return { ...last, busy: true };
			throw lastError;
		}
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
};
