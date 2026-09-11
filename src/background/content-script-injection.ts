/**
 * Puts the declared content script into a tab that is not answering.
 *
 * A tab can end up with no listener for reasons no amount of retrying can fix:
 * the declarative injection was withheld (the user set this extension's site
 * access to "on click"), the script's module graph threw before
 * `chrome.runtime.onMessage.addListener` ran, or the extension reloaded under a
 * tab that stayed open. Every message to that tab then fails with "Receiving end
 * does not exist" for the life of the document, which is why the agent looks
 * broken on a page the user can see perfectly well — and why using Memorall from
 * the context menu appears to "fix" it: that grants activeTab, which injects the
 * script.
 *
 * `chrome.scripting.executeScript` does the same thing without waiting for a
 * click. It needs no host permission beyond what the manifest already declares,
 * and re-running the script on a tab that *does* have it is harmless — the
 * listener it registers answers exactly as before.
 */

import { logError, logInfo } from "@/utils/logger";

const CONTENT_SCRIPT_FILES: string[] = (() => {
	try {
		const declared = chrome.runtime.getManifest().content_scripts ?? [];
		return declared.flatMap((entry) => entry.js ?? []);
	} catch {
		return [];
	}
})();

/**
 * Tabs already given a second chance for their current document. One attempt is
 * the whole budget: a tab that cannot be injected (a restricted page) would
 * otherwise be retried on every poll of every retry loop.
 */
const reinjectedTabs = new Set<number>();

export const isMissingContentScriptError = (message: string): boolean =>
	message.includes("Receiving end does not exist") ||
	message.includes("Could not establish connection") ||
	message.includes("The message port closed before");

export const reinjectContentScript = async (
	tabId: number,
): Promise<boolean> => {
	if (reinjectedTabs.has(tabId)) return false;
	if (!chrome.scripting?.executeScript || CONTENT_SCRIPT_FILES.length === 0) {
		return false;
	}

	reinjectedTabs.add(tabId);
	try {
		await chrome.scripting.executeScript({
			target: { tabId, allFrames: false },
			files: CONTENT_SCRIPT_FILES,
		});
		logInfo("[CONTENT_SCRIPT_INJECTION] Re-injected into tab", tabId);
		return true;
	} catch (error) {
		logError(
			"[CONTENT_SCRIPT_INJECTION] Could not re-inject into tab",
			tabId,
			error,
		);
		return false;
	}
};

/** Forget a tab's attempt, so the next document gets its own. */
export const forgetReinjectedTab = (tabId: number): void => {
	reinjectedTabs.delete(tabId);
};

let listenersRegistered = false;

/**
 * A new document gets its own declarative injection, so the "already tried" mark
 * is per-navigation, not per-tab-for-ever. Idempotent: several handlers call it.
 */
export const registerContentScriptInjectionListeners = (): void => {
	if (listenersRegistered) return;
	listenersRegistered = true;

	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.status === "loading") forgetReinjectedTab(tabId);
	});
	chrome.tabs.onRemoved.addListener((tabId) => forgetReinjectedTab(tabId));
};
