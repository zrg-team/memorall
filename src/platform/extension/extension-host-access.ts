import type { HostAccessPort } from "../contracts/core";
import { logError } from "@/utils/logger";

/**
 * `chrome.permissions` over the manifest's host permissions.
 *
 * Declaring a host in `host_permissions` is not the same as holding it. Chrome
 * withholds host permissions that arrive in an update until the user accepts
 * them, and the site-access menu can revoke them later — in both states the
 * page is back under CORS, and a host like Composio's that answers no
 * `Access-Control-Allow-Origin` for extension origins simply stops responding.
 *
 * Contexts without the API (a worker, a test) answer `true`: this is a gate in
 * front of a request that would fail loudly on its own, so guessing "granted"
 * costs an error message the caller already handles, while guessing "denied"
 * would block a call that might have worked.
 */
export class ExtensionHostAccessPort implements HostAccessPort {
	async has(origins: string[]): Promise<boolean> {
		if (origins.length === 0) return true;
		const permissions = globalThis.chrome?.permissions;
		if (!permissions?.contains) return true;
		try {
			return await permissions.contains({ origins });
		} catch (error) {
			logError("[HOST_ACCESS] Permission check failed:", error);
			return true;
		}
	}

	async request(origins: string[]): Promise<boolean> {
		if (origins.length === 0) return true;
		const permissions = globalThis.chrome?.permissions;
		if (!permissions?.request) return true;
		try {
			return await permissions.request({ origins });
		} catch (error) {
			// Thrown when there is no user gesture, and on surfaces that cannot
			// prompt at all. Neither is a grant.
			logError("[HOST_ACCESS] Permission request failed:", error);
			return false;
		}
	}
}
