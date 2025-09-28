// chromePortTransport.ts
// Strictly-typed RpcTransport implementation for browser extensions using
// chrome.runtime Port messaging (best performance for MV3 extensions).

import type { RpcRequest, RpcResponse, RpcTransport } from "./types";
import { serializeForRpc, deserializeFromRpc } from "./serialization";

export interface ChromePortTransportOptions {
	/** Port name; must match on the server side. Default: "pglite-rpc". */
	channelName?: string;
	/**
	 * Ensure the Offscreen Document exists before connecting.
	 * Provide a function that creates it if missing (MV3 Offscreen API).
	 */
	ensureOffscreen?: () => Promise<void>;
	/** Automatic reconnect with exponential backoff (enabled by default). */
	reconnect?: {
		enabled?: boolean;
		initialDelayMs?: number; // default 100
		maxDelayMs?: number; // default 2000
		factor?: number; // default 2
	};
}

/** Type guard to validate RpcResponse shape at runtime. */
function isRpcResponse(value: unknown): value is RpcResponse {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "number") return false;
	if (typeof v.ok !== "boolean") return false;
	if (v.ok) {
		// ok:true => data present (any JSON-serializable value)
		return "data" in v;
	}
	// ok:false => error:string
	return typeof v.error === "string";
}

/**
 * Create a high-performance RpcTransport backed by chrome.runtime Port.
 * Uses structured clone for messages (no JSON stringify/parse).
 */
export async function createChromePortTransport(
	options: ChromePortTransportOptions = {},
): Promise<RpcTransport> {
	const {
		channelName = "pglite-rpc",
		ensureOffscreen,
		reconnect = {},
	} = options;

	const reconnectEnabled = reconnect.enabled ?? true;
	const backoffInit = reconnect.initialDelayMs ?? 100;
	const backoffMax = reconnect.maxDelayMs ?? 2000;
	const backoffFactor = reconnect.factor ?? 2;

	let port: chrome.runtime.Port | null = null;
	let disposed = false;
	let connecting: Promise<void> | null = null;

	const subscribers = new Set<(msg: RpcResponse) => void>();
	const queue: RpcRequest[] = [];

	let backoff = backoffInit;

	const handleMessage = (msg: unknown): void => {
		const deserializedMsg = deserializeFromRpc(msg);
		if (!isRpcResponse(deserializedMsg)) return;
		subscribers.forEach((fn) => fn(deserializedMsg));
	};

	const handleDisconnect = (): void => {
		if (port) {
			port.onMessage.removeListener(handleMessage);
			port.onDisconnect.removeListener(handleDisconnect);
			port = null;
		}
		if (!reconnectEnabled || disposed) return;

		const delay = backoff;
		backoff = Math.min(backoff * backoffFactor, backoffMax);
		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		setTimeout(connect, delay);
	};

	const connect = async (): Promise<void> => {
		if (disposed) return;
		if (connecting) return connecting;

		connecting = (async () => {
			if (ensureOffscreen) {
				try {
					await ensureOffscreen();
				} catch {
					// Offscreen may already exist; ignore.
				}
			}

			const p = chrome.runtime.connect({ name: channelName });
			p.onMessage.addListener(handleMessage);
			p.onDisconnect.addListener(handleDisconnect);
			port = p;

			// Flush queued messages
			while (queue.length > 0 && port) {
				const m = queue.shift()!;
				const serializedM = serializeForRpc(m);
				port.postMessage(serializedM);
			}

			backoff = backoffInit;
		})();

		await connecting;
		connecting = null;
	};

	await connect();

	const transport: RpcTransport = {
		post(msg: RpcRequest): void {
			if (disposed) return;
			const serializedMsg = serializeForRpc(msg);
			if (port) {
				try {
					port.postMessage(serializedMsg);
				} catch {
					// If posting fails due to a race with disconnect, enqueue and reconnect.
					queue.push(msg);
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					connect();
				}
			} else {
				queue.push(msg);
				// eslint-disable-next-line @typescript-eslint/no-floating-promises
				connect();
			}
		},

		subscribe(handler: (msg: RpcResponse) => void): () => void {
			subscribers.add(handler);
			return () => {
				subscribers.delete(handler);
			};
		},
	};

	return transport;
}
