import { DatabaseRpcHandler } from "./rpc-handler";
import type { DatabaseRpcServer } from "./rpc-server";

export function getDatabaseRpcServer(): DatabaseRpcServer {
	return DatabaseRpcHandler.getInstance();
}
