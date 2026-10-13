// RPC handler for main mode database instance
// Handles incoming RPC requests from proxy instances

import { logError, logInfo } from "@/utils/logger";
import { getPGLite } from "../db";
import { serializeForRpc, deserializeFromRpc } from "./serialization";
import type {
	RpcRequest,
	RpcResponse,
	WorkerQueryPayload,
	WorkerExecPayload,
	WorkerQueryResult,
} from "./types";

interface QueuedResponse {
	response: RpcResponse;
	timestamp: number;
	retryCount: number;
	port: chrome.runtime.Port;
}

/**
 * Serves database requests from pages over `runtime.connect` ports.
 *
 * Each request arrives once, on the port of the page that sent it, and is
 * answered on that port. (A service-worker relay used to forward every page
 * port as well, so each request arrived twice and the answers were cached to
 * deduplicate them.)
 */
export class DatabaseRpcHandler {
	private static instance: DatabaseRpcHandler;
	private ports = new Map<string, chrome.runtime.Port>();
	private responseQueue: QueuedResponse[] = [];
	private readonly maxRetries = 5;
	private readonly maxQueueSize = 100;
	private readonly queueTimeout = 30000; // 30 seconds
	private retryTimer: ReturnType<typeof setTimeout> | null = null;

	// Track listener registration to prevent duplicates
	private isListening: boolean = false;
	private currentChannelName: string | null = null;
	private connectionListener: ((port: chrome.runtime.Port) => void) | null =
		null;

	static getInstance(): DatabaseRpcHandler {
		if (!DatabaseRpcHandler.instance) {
			DatabaseRpcHandler.instance = new DatabaseRpcHandler();
		}
		return DatabaseRpcHandler.instance;
	}

	// Start listening for RPC connections
	startListening(channelName: string): void {
		// Prevent duplicate listeners
		logInfo(`[DB] RPC handler ${channelName}`);
		if (this.isListening && this.currentChannelName === channelName) {
			logInfo(
				`[DB] 📡 RPC handler already listening on channel: ${channelName}`,
			);
			return;
		}

		// Remove existing listener if channel changed
		if (this.isListening && this.connectionListener) {
			try {
				chrome.runtime.onConnect.removeListener(this.connectionListener);
				logInfo(
					`[DB] 📡 Removed previous RPC listener for channel: ${this.currentChannelName}`,
				);
			} catch (error) {
				logError("[DB] ⚠️ Failed to remove previous listener:", error);
			}
		}

		// Create and store the listener
		this.connectionListener = (port: chrome.runtime.Port) => {
			if (port.name !== channelName) return;

			const portId = `${channelName}-${Date.now()}-${Math.random()}`;
			this.ports.set(portId, port);

			logInfo(`[DB] 📡 RPC connection established: ${portId}`, {
				total: this.ports.size,
				timestamp: new Date().toISOString(),
			});

			// Capture port in closure so each message is routed back to its sender
			port.onMessage.addListener((request: RpcRequest) =>
				this.handleMessage(request, port),
			);

			port.onDisconnect.addListener(() => {
				this.ports.delete(portId);
				this.cleanupQueueForPort(port);
				logInfo(`[DB] 📡 RPC disconnected: ${portId}`, {
					remaining: this.ports.size,
					timestamp: new Date().toISOString(),
				});
			});
		};

		try {
			chrome.runtime.onConnect.addListener(this.connectionListener);
			logInfo(`[DB] ✅ RPC listener registered for channel: ${channelName}`);
		} catch (error) {
			logError("[DB] 🔍 RPC HANDLER: ERROR adding listener:", error);
			throw error;
		}

		this.isListening = true;
		this.currentChannelName = channelName;
	}

	// Handle incoming RPC messages
	private async handleMessage(
		request: RpcRequest,
		senderPort: chrome.runtime.Port,
	): Promise<void> {
		const { id, op, payload } = request;

		try {
			// Deserialize payload (handles Date objects from proxy)
			const deserializedPayload = deserializeFromRpc(payload);

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
			this.sendResponse({ id, ok: true, data: serializedResult }, senderPort);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			logError(`❌ RPC operation '${op}' failed:`, error);
			this.sendResponse({ id, ok: false, error: errorMessage }, senderPort);
		}
	}

	// Handle query operations
	private async handleQuery(
		payload: WorkerQueryPayload,
	): Promise<WorkerQueryResult> {
		const pglite = getPGLite();
		const { sql, params, rowMode } = payload;

		// Execute query on the real PGlite instance
		const result = await pglite.query(sql, params, { rowMode });

		// Return complete result including fields metadata
		// Drizzle needs the fields array to map column positions to names in array mode
		// Must match PGlite's Results type (affectedRows, not rowCount)
		return {
			rows: result.rows,
			fields: "fields" in result ? result.fields : undefined,
			affectedRows: "affectedRows" in result ? result.affectedRows : undefined,
		};
	}

	// Handle exec operations
	private async handleExec(payload: WorkerExecPayload) {
		const pglite = getPGLite();
		const { sql } = payload;

		// Execute SQL on the real PGlite instance
		await pglite.exec(sql);
	}

	// Send response back to the specific proxy port that made the request
	private sendResponse(
		response: RpcResponse,
		senderPort: chrome.runtime.Port,
	): void {
		try {
			senderPort.postMessage(response);
		} catch (error) {
			logError(
				`[DB] ❌ Failed to send response for request ${response.id}:`,
				error,
			);
			this.queueResponse(response, senderPort);
		}
	}

	// Queue a response for retry, associated with the port that should receive it
	private queueResponse(
		response: RpcResponse,
		senderPort: chrome.runtime.Port,
	): void {
		// Clean old responses from queue first
		this.cleanupQueue();

		// Check queue size limit
		if (this.responseQueue.length >= this.maxQueueSize) {
			logError(
				`❌ Response queue full (${this.maxQueueSize}), dropping oldest response`,
			);
			this.responseQueue.shift();
		}

		this.responseQueue.push({
			response,
			timestamp: Date.now(),
			retryCount: 0,
			port: senderPort,
		});

		// Schedule retry if not already scheduled
		this.scheduleRetry();
	}

	// Remove expired responses from queue
	private cleanupQueue(): void {
		const now = Date.now();
		const initialLength = this.responseQueue.length;

		this.responseQueue = this.responseQueue.filter((item) => {
			const age = now - item.timestamp;
			if (age > this.queueTimeout) {
				logError(
					`[DB] ❌ Response ${item.response.id} expired after ${age}ms, dropping`,
				);
				return false;
			}
			return true;
		});

		const removed = initialLength - this.responseQueue.length;
		if (removed > 0) {
			logInfo(`[DB] 🧹 Cleaned up ${removed} expired responses from queue`);
		}
	}

	// Schedule a retry attempt with exponential backoff
	private scheduleRetry(): void {
		if (this.retryTimer) {
			return; // Already scheduled
		}

		// Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
		const maxRetryCount = Math.max(
			...this.responseQueue.map((q) => q.retryCount),
			0,
		);
		const delay = Math.min(100 * Math.pow(2, maxRetryCount), 5000);

		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.flushResponseQueue();
		}, delay);
	}

	// Drop all queued responses for a disconnected port (proxy will re-request via its own retry)
	private cleanupQueueForPort(port: chrome.runtime.Port): void {
		const before = this.responseQueue.length;
		this.responseQueue = this.responseQueue.filter(
			(item) => item.port !== port,
		);
		const dropped = before - this.responseQueue.length;
		if (dropped > 0) {
			logInfo(
				`[DB] 🧹 Dropped ${dropped} queued responses for disconnected port`,
			);
		}
	}

	// Attempt to flush queued responses, each to its own port
	private flushResponseQueue(): void {
		if (this.responseQueue.length === 0) {
			return;
		}

		logInfo(
			`[DB] 🔄 Flushing response queue (${this.responseQueue.length} responses)`,
		);
		const failedResponses: QueuedResponse[] = [];

		for (const queuedItem of this.responseQueue) {
			try {
				queuedItem.port.postMessage(queuedItem.response);
				logInfo(
					`[DB] ✅ Queued response ${queuedItem.response.id} sent successfully (retry ${queuedItem.retryCount})`,
				);
			} catch (error) {
				queuedItem.retryCount++;

				if (queuedItem.retryCount >= this.maxRetries) {
					logError(
						`[DB] ❌ Response ${queuedItem.response.id} failed after ${queuedItem.retryCount} retries, dropping`,
					);
				} else {
					logError(
						`[DB] ⚠️ Failed to send queued response ${queuedItem.response.id} (retry ${queuedItem.retryCount}/${this.maxRetries}):`,
						error,
					);
					failedResponses.push(queuedItem);
				}
			}
		}

		this.responseQueue = failedResponses;

		// Schedule another retry if there are still failed responses
		if (this.responseQueue.length > 0) {
			this.scheduleRetry();
		}
	}

	// Stop the RPC handler
	stop(): void {
		// Clear retry timer
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}

		// Clear response queue
		if (this.responseQueue.length > 0) {
			logError(
				`[DB] ⚠️ Stopping RPC handler with ${this.responseQueue.length} queued responses`,
			);
			this.responseQueue = [];
		}

		// Disconnect all active ports
		for (const port of this.ports.values()) {
			try {
				port.disconnect();
			} catch {}
		}
		this.ports.clear();
	}
}
