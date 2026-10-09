/**
 * The browser's permission for Memorall to run on web pages at all.
 *
 * Every web tool reads a page through the declared content script, and the
 * browser only runs it where the extension holds site access. Users can narrow
 * that from the extension's toolbar menu to "When you click the extension" or
 * "On specific sites" — a store install keeps the choice across updates, an
 * unpacked build never has it. Withheld, the script is never injected, the
 * fallback `chrome.scripting.executeScript` is refused for the same reason, and
 * each tool used to retry until its deadline before giving up with a guess.
 *
 * Pure strings and patterns only: the background, the chat and the MemonOS
 * Browser all import this, and none of it may touch a browser API.
 */

/**
 * Every http(s) site. A manifest host pattern ignores its path, so the
 * manifest's `*://*\/*.pdf` already declares this; asking for it with
 * `chrome.permissions.request` grants back what the user withheld.
 */
export const ALL_SITES_ORIGINS = ["*://*/*"];

/** Leads every error a web tool reports for a page it may not run on. */
export const SITE_ACCESS_WITHHELD_MARKER = "Site access withheld";

/** The match pattern covering `url`'s site, or null where site access does not apply. */
export const siteAccessOriginFor = (url: string | undefined): string | null => {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return `${parsed.protocol}//${parsed.hostname}/*`;
	} catch {
		return null;
	}
};

const hostOf = (url: string | undefined): string => {
	if (!url) return "this site";
	try {
		return new URL(url).hostname || url;
	} catch {
		return url;
	}
};

/**
 * What a web tool reports. Written for the model: it names the cause, says
 * retrying cannot help, and says what the user has in front of them.
 */
export const siteAccessWithheldMessage = (url: string | undefined): string =>
	`${SITE_ACCESS_WITHHELD_MARKER} for ${hostOf(url)}: the browser only lets Memorall read pages when the user clicks it, so no web tool can read this page and retrying will not help. The user has an "Allow on all sites" button in the chat; ask them to press it, then try again.`;

export const isSiteAccessWithheldMessage = (
	text: string | undefined | null,
): boolean => Boolean(text?.includes(SITE_ACCESS_WITHHELD_MARKER));
