import type { RpcTransport } from "./types";

export interface DatabaseProxyTransportOptions {
	channelName?: string;
}

export type DatabaseProxyTransportFactory = (
	options: DatabaseProxyTransportOptions,
) => Promise<RpcTransport>;
