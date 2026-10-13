import { BACKGROUND_EVENTS } from "@/constants/events";
import { createChromePortTransport } from "./chrome-port-rpc";
import type { DatabaseProxyTransportFactory } from "./proxy-transport";

// The database lives in the offscreen document; the background service worker
// creates that document again when it is missing.
const ensureOffscreen = async (): Promise<void> => {
	await chrome.runtime.sendMessage({
		type: BACKGROUND_EVENTS.ENSURE_OFFSCREEN,
	});
};

export const createDatabaseProxyTransport: DatabaseProxyTransportFactory = (
	options,
) => createChromePortTransport({ ...options, ensureOffscreen });
