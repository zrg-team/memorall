/**
 * Capturing what a tab is actually showing, for the content script that asked.
 *
 * The embedded capture path used html2canvas, which re-renders the page from
 * computed styles. Measured against a page whose image comes from another origin
 * with no CORS header — every map tile, every CDN image — it silently leaves
 * that image out: the canvas comes back white where the content was, with no
 * error raised, and each image is re-requested twice on the way. On a map page
 * the result is a blank picture of nothing.
 *
 * `captureVisibleTab` returns what the compositor already painted, so
 * cross-origin tiles, `<canvas>`, WebGL and iframes all come out, at zero extra
 * requests. The catch is permission: it needs `<all_urls>` or `activeTab`, and
 * this extension deliberately has neither as a blanket grant. `activeTab` is
 * granted when the user invokes Memorall from the context menu and lasts for
 * that tab until it navigates — which is exactly how the co-agent and smart
 * select are started. When the grant is not there the call fails, and saying so
 * is better than quietly returning a white rectangle.
 */

import { logError } from "@/utils/logger";

export const VIEWPORT_CAPTURE_SOURCE = "memorall:capture-visible-tab" as const;

export interface ViewportCaptureRequest {
	source: typeof VIEWPORT_CAPTURE_SOURCE;
}

export type ViewportCaptureResponse =
	| {
			source: typeof VIEWPORT_CAPTURE_SOURCE;
			success: true;
			dataUrl: string;
	  }
	| {
			source: typeof VIEWPORT_CAPTURE_SOURCE;
			success: false;
			error: string;
			/** The caller can offer the context-menu route to earn the grant. */
			needsActivation: boolean;
	  };

export const isViewportCaptureRequest = (
	value: unknown,
): value is ViewportCaptureRequest =>
	typeof value === "object" &&
	value !== null &&
	(value as { source?: unknown }).source === VIEWPORT_CAPTURE_SOURCE;

export const isViewportCaptureResponse = (
	value: unknown,
): value is ViewportCaptureResponse =>
	typeof value === "object" &&
	value !== null &&
	(value as { source?: unknown }).source === VIEWPORT_CAPTURE_SOURCE &&
	typeof (value as { success?: unknown }).success === "boolean";

/** Chrome's wording when neither `<all_urls>` nor an activeTab grant is held. */
const isPermissionError = (message: string): boolean =>
	message.includes("activeTab") ||
	message.includes("<all_urls>") ||
	message.includes("permission");

const capture = async (
	tab: chrome.tabs.Tab | undefined,
): Promise<ViewportCaptureResponse> => {
	try {
		if (typeof tab?.windowId !== "number") {
			throw new Error("The page has no window to capture.");
		}
		const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
			format: "png",
		});
		return { source: VIEWPORT_CAPTURE_SOURCE, success: true, dataUrl };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logError("[VIEWPORT_CAPTURE] Failed:", error);
		return {
			source: VIEWPORT_CAPTURE_SOURCE,
			success: false,
			error: message,
			needsActivation: isPermissionError(message),
		};
	}
};

export function registerViewportCaptureHandler(): void {
	chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
		if (!isViewportCaptureRequest(rawMessage)) return false;

		// Always the sender's own tab: a page may only ask for a picture of itself.
		void capture(sender.tab).then(sendResponse);
		return true;
	});
}
