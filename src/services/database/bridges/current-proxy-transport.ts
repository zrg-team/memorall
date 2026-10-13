import {
	createChromePortTransport,
	requestOffscreenDocument,
} from "./chrome-port-rpc";
import type { DatabaseProxyTransportFactory } from "./proxy-transport";

export const createDatabaseProxyTransport: DatabaseProxyTransportFactory = (
	options,
) =>
	createChromePortTransport({
		...options,
		ensureOffscreen: requestOffscreenDocument,
	});
