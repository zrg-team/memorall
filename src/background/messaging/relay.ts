import type { JobNotificationMessage } from "@/services/background-jobs/bridges/types";

// ── Job notification relay ────────────────────────────────────────────────────
// The ONLY relay needed in the architecture: forward job notifications that target
// content scripts, since chrome.runtime.sendMessage() cannot reach them directly.
//
// Broadcasts are the hot path: a streaming chat emits a JOB_PROGRESS per buffered
// chunk, each targeted "all". Enumerating every tab and messaging every one of
// them per chunk cost the service worker time proportional to (chunks × open
// tabs) for an audience that is almost always empty — the chat that asked for the
// job usually lives in an extension page, which chrome.runtime.sendMessage
// already reached directly.
//
// So tabs opt in. A content script that creates a job announces itself (and the
// background also registers any tab it sees a notification come from), and only
// those tabs are relayed to. With no interested tab the relay costs nothing.

const interestedTabs = new Set<number>();

/**
 * Whether a notification's sender is a tab that the relay must talk to.
 *
 * Only content scripts qualify. An extension page opened in a tab — the options
 * page, standalone chat — also carries a `sender.tab.id`, but
 * chrome.runtime.sendMessage already delivers to it directly. Registering one
 * would relay every message to a page that had already received it, and a chat
 * accumulating `content += delta` renders each fragment twice. The old
 * broadcast excluded `chrome-extension://` tabs for exactly this reason.
 *
 * `message.sender` is the bridge's own context detection, which is the
 * authority here; the URL check is a second line of defence.
 */
export function isRelayableContentSender(
	message: Pick<JobNotificationMessage, "sender">,
	sender: { tab?: { id?: number }; url?: string },
): boolean {
	return (
		message.sender === "content" &&
		typeof sender.tab?.id === "number" &&
		!sender.url?.startsWith("chrome-extension://")
	);
}

export function registerContentJobConsumer(tabId: number | undefined): void {
	if (typeof tabId === "number") interestedTabs.add(tabId);
}

export function unregisterContentJobConsumer(tabId: number | undefined): void {
	if (typeof tabId === "number") interestedTabs.delete(tabId);
}

export function getContentJobConsumerCount(): number {
	return interestedTabs.size;
}

export async function relayJobNotificationToContent(
	message: JobNotificationMessage,
	senderTabId: number | undefined,
): Promise<void> {
	// Specific tab target
	if (message.target === "content" && (message.tabId ?? senderTabId)) {
		const tabId = (message.tabId ?? senderTabId)!;
		await chrome.tabs.sendMessage(tabId, message).catch(() => {
			// Tab may not have content script — silently ignore
		});
		return;
	}

	// Broadcast — only to tabs that have shown they consume job notifications.
	if (interestedTabs.size === 0) return;

	await Promise.allSettled(
		[...interestedTabs].map((tabId) =>
			chrome.tabs.sendMessage(tabId, message).catch(() => {
				// Tab closed, navigated away, or has no content script any more.
				interestedTabs.delete(tabId);
			}),
		),
	);
}
