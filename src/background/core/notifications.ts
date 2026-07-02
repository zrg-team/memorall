import { openStandalonePage } from "@/utils/open-standalone";

export function createNotification(title: string, message: string): void {
	chrome.notifications?.create({
		type: "basic" as const,
		title,
		message,
		iconUrl: chrome.runtime.getURL("icons/extension_48.png"),
	});
}

/**
 * Opens the extension UI. The toolbar action no longer has a popup — every
 * "open the app" entry point now opens the standalone page.
 */
export async function openExtensionPopup(): Promise<void> {
	await openStandalonePage();
}
