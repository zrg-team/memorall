import type { DatabaseProxyTransportFactory } from "./proxy-transport";

export const createDatabaseProxyTransport: DatabaseProxyTransportFactory =
	async () => {
		throw new Error(
			"Database proxy transport is unavailable in this environment; use the local database service.",
		);
	};
