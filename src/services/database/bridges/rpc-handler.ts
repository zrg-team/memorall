// RPC handler for main mode database instance
// Handles incoming RPC requests from proxy instances

import { logError, logInfo } from "@/utils/logger";
import { getPGLite, isMainMode } from "../db";
import { serializeForRpc, deserializeFromRpc } from "./serialization";
import type {
	RpcRequest,
	RpcResponse,
	WorkerQueryPayload,
	WorkerExecPayload,
} from "./types";

export class DatabaseRpcHandler {
	private static instance: DatabaseRpcHandler;
	private port: chrome.runtime.Port | null = null;

	static getInstance(): DatabaseRpcHandler {
		if (!DatabaseRpcHandler.instance) {
			DatabaseRpcHandler.instance = new DatabaseRpcHandler();
		}
		return DatabaseRpcHandler.instance;
	}

	// Start listening for RPC connections
	startListening(channelName: string = "pglite-rpc"): void {
		if (!isMainMode()) {
			logError("❌ RPC handler can only run in main mode");
			return;
		}

		chrome.runtime.onConnect.addListener((port) => {
			if (port.name === channelName) {
				logInfo(`📡 RPC connection established: ${channelName}`);
				this.port = port;
				port.onMessage.addListener(this.handleMessage.bind(this));
				port.onDisconnect.addListener(() => {
					logInfo("📡 RPC connection disconnected");
					this.port = null;
				});
			}
		});
	}

	// Handle incoming RPC messages
	private async handleMessage(request: RpcRequest): Promise<void> {
		const { id, op, payload } = request;

		// Deserialize payload (handles Date objects from proxy)
		const deserializedPayload = deserializeFromRpc(payload);

		try {
			let result: unknown = null;

			switch (op) {
				case "health":
					result = { status: "ok" };
					break;

				case "query":
					result = await this.handleQuery(
						deserializedPayload as WorkerQueryPayload,
					);
					break;

				case "exec":
					await this.handleExec(deserializedPayload as WorkerExecPayload);
					result = null;
					break;

				case "transaction":
					// Transaction handling would require more complex state management
					// For now, we'll treat it as a series of queries
					throw new Error(
						"Transaction support not implemented in RPC handler yet",
					);

				case "close":
					// Proxy close - just acknowledge
					result = null;
					break;

				default:
					throw new Error(`Unsupported RPC operation: ${op}`);
			}

			// Serialize result before sending (handles Date objects to proxy)
			const serializedResult = serializeForRpc(result);
			this.sendResponse({ id, ok: true, data: serializedResult });
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			logError(`❌ RPC operation '${op}' failed:`, error);
			this.sendResponse({ id, ok: false, error: errorMessage });
		}
	}

	// Handle query operations
	private async handleQuery(payload: WorkerQueryPayload) {
		const pglite = getPGLite();
		const { sql, params, rowMode } = payload;

		// Execute query on the real PGlite instance
		const result = await pglite.query(sql, params, { rowMode });
		return {
			rows: result.rows,
			rowCount: "rowCount" in result ? result.rowCount : undefined,
		};
	}

	// Handle exec operations
	private async handleExec(payload: WorkerExecPayload) {
		const pglite = getPGLite();
		const { sql } = payload;

		// Execute SQL on the real PGlite instance
		await pglite.exec(sql);
	}

	// Send response back to proxy
	private sendResponse(response: RpcResponse): void {
		if (this.port) {
			this.port.postMessage(response);
		} else {
			logError("❌ No RPC port available to send response");
		}
	}

	// Stop the RPC handler
	stop(): void {
		if (this.port) {
			this.port.disconnect();
			this.port = null;
		}
	}
}
