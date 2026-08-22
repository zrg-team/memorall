/**
 * The browser's permission to talk to Composio at all.
 *
 * Composio's API answers CORS preflights without an `Access-Control-Allow-Origin`
 * header for anything but its own dashboard, so every call from a browser build
 * depends on the platform granting the host up front. The extension declares
 * `https://backend.composio.dev/*` in its manifest, but Chrome withholds host
 * permissions introduced by an update until the user accepts them and lets the
 * site-access menu revoke them afterwards. Withheld, every request dies in
 * preflight as an opaque `TypeError: Failed to fetch`.
 */

import { platform } from "@/platform/current";

/** Matches the manifest's `host_permissions` entries for Composio. */
export const COMPOSIO_HOST_ORIGINS = [
	"https://backend.composio.dev/*",
	"https://*.composio.dev/*",
];

/** Whether Composio calls will reach the network right now. */
export async function hasComposioHostAccess(): Promise<boolean> {
	const hostAccess = platform.hostAccess;
	if (!hostAccess) return true;
	return hostAccess.has(COMPOSIO_HOST_ORIGINS);
}

/**
 * Grant-or-ask. Call it from a click handler: Chrome only opens the permission
 * prompt inside a user gesture, and returns false rather than prompting when
 * there is none.
 */
export async function ensureComposioHostAccess(): Promise<boolean> {
	const hostAccess = platform.hostAccess;
	if (!hostAccess) return true;
	if (await hostAccess.has(COMPOSIO_HOST_ORIGINS)) return true;
	return hostAccess.request(COMPOSIO_HOST_ORIGINS);
}
