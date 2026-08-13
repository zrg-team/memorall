import type { DatabaseRpcServer } from "./rpc-server";

const server: DatabaseRpcServer = {
	startListening: () => undefined,
	stop: () => undefined,
};

export function getDatabaseRpcServer(): DatabaseRpcServer {
	return server;
}
