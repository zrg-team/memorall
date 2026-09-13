/**
 * Keeps a tab the agent is working in from being frozen by the browser.
 *
 * Agent tabs open in the background, and browsers freeze background tabs to
 * save resources — Edge's sleeping tabs do it after as little as 30 seconds, and
 * Chrome's Memory and Energy Saver do the same. A frozen tab runs nothing, so
 * its content script never answers: every web tool on it waited out its
 * deadline, and before those waits were bounded, until the browser shut the
 * service worker down. The user saw the page loaded and the agent saw nothing.
 *
 * Chromium does not freeze a page that holds a Web Lock, and a lock taken from
 * the extension's isolated world counts. `autoDiscardable: false` does not help:
 * it stops discarding, not freezing, and Edge froze a tab carrying it within
 * 30 seconds.
 *
 * The lock belongs to the document, so it is taken again for every page the tab
 * loads, and it goes away with the tab. Shared mode, because an exclusive lock
 * would make a second agent tab on the same site wait behind the first instead
 * of holding one. Web Locks need a secure context, so a plain-HTTP page cannot
 * be kept awake this way; nothing else changes for it.
 */

export const AGENT_TAB_AWAKE_LOCK = "memorall:agent-tab-awake";

/** Runs in the page's isolated world, so it must not close over anything. */
export const holdAwakeLock = (lockName: string): boolean => {
	const marker = "__memorallAgentTabAwake";
	const scope = window as unknown as Record<string, unknown>;
	if (scope[marker]) return true;
	if (!navigator.locks) return false;
	scope[marker] = true;
	void navigator.locks
		.request(lockName, { mode: "shared" }, () => new Promise<void>(() => {}))
		.catch(() => {
			scope[marker] = false;
		});
	return true;
};

/**
 * Never throws: a tab that cannot be scripted (a restricted page, one already
 * closed) simply is not kept awake, which is no worse than before.
 */
export const keepAgentTabAwake = async (
	tabId: number,
	timeoutMs = 5_000,
): Promise<boolean> => {
	if (!chrome.scripting?.executeScript) return false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Bounded: a tab that is already frozen cannot run the script either, and
		// would otherwise hold this call open for as long as it stays frozen.
		const [injection] = await Promise.race([
			chrome.scripting.executeScript({
				target: { tabId, allFrames: false },
				func: holdAwakeLock,
				args: [AGENT_TAB_AWAKE_LOCK],
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
			}),
		]);
		return injection?.result === true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
};
