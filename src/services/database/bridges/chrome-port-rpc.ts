// chromePortTransport.ts
// Strictly-typed RpcTransport implementation for browser extensions using
// chrome.runtime Port messaging (best performance for MV3 extensions).

import type { RpcRequest, RpcResponse, RpcTransport } from "./types";
import { serializeForRpc } from "./serialization";
import { BACKGROUND_EVENTS } from "@/constants/events";
import { logInfo, logWarn } from "@/utils/logger";

/**
 * Ask the background service worker to create the offscreen document again
 * if it is missing: the database lives there.
 */
export const requestOffscreenDocument = async (): Promise<void> => {
	await chrome.runtime.sendMessage({
		type: BACKGROUND_EVENTS.ENSURE_OFFSCREEN,
	});
};

export interface ChromePortTransportOptions {
	/** Port name; must match on the server side */
	channelName?: string;
	/**
	 * Ask for the server's document (the MV3 offscreen document) to be created.
	 * Called before reconnecting after a connection the server never answered.
	 */
	ensureOffscreen?: () => Promise<void>;
	/** Automatic reconnect with exponential backoff (enabled by default). */
	reconnect?: {
		enabled?: boolean;
		initialDelayMs?: number; // default 100
		maxDelayMs?: number; // default 2000
		factor?: number; // default 2
	};
	/** Heartbeat interval in ms to detect dead connections (default: 30000, 0 disables) */
	heartbeatIntervalMs?: number;
	/** How long the server has to answer a handshake or heartbeat (default: 2000). */
	responseTimeoutMs?: number;
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
 * Create an RpcTransport backed by a chrome.runtime Port.
 *
 * `runtime.connect` reaches every extension context with an `onConnect`
 * listener, and a port opened before the server registered its listener —
 * or after the server's document went away — can look connected while
 * nobody reads it. So a port carries requests only once the server answered a
 * handshake on it; until then they wait here. A heartbeat the server stops
 * answering drops the port the same way.
 */
export async function createChromePortTransport(
	options: ChromePortTransportOptions = {},
): Promise<RpcTransport> {
	const {
		channelName,
		ensureOffscreen,
		reconnect = {},
		heartbeatIntervalMs = 30000,
		responseTimeoutMs = 2000,
	} = options;

	const reconnectEnabled = reconnect.enabled ?? true;
	const backoffInit = reconnect.initialDelayMs ?? 100;
	const backoffMax = reconnect.maxDelayMs ?? 2000;
	const backoffFactor = reconnect.factor ?? 2;

	let port: chrome.runtime.Port | null = null;
	/** The server answered the handshake on `port`. */
	let ready = false;
	let disposed = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	/** Waits for the answer to the handshake or the latest heartbeat. */
	let responseTimer: ReturnType<typeof setTimeout> | null = null;
	let controlId: number | null = null;
	let unansweredConnects = 0;
	let backoff = backoffInit;
	let nextControlId = 0;

	const subscribers = new Set<(msg: RpcResponse) => void>();
	const queue: RpcRequest[] = [];

	// Negative ids never collide with the proxy's positive request ids.
	const newControlId = (): number => {
		nextControlId = (nextControlId + 1) % 1_000_000_000;
		return -(nextControlId + 1);
	};

	const clearResponseTimer = (): void => {
		if (responseTimer) clearTimeout(responseTimer);
		responseTimer = null;
		controlId = null;
	};

	const stopHeartbeat = (): void => {
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	};

	const scheduleReconnect = (): void => {
		if (!reconnectEnabled || disposed || reconnectTimer) return;
		const delay = backoff;
		backoff = Math.min(backoff * backoffFactor, backoffMax);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect();
		}, delay);
	};

	const dropPort = (reason: string): void => {
		stopHeartbeat();
		clearResponseTimer();
		const current = port;
		port = null;
		ready = false;
		if (current) {
			current.onMessage.removeListener(handleMessage);
			current.onDisconnect.removeListener(handleDisconnect);
			try {
				current.disconnect();
			} catch {
				// Already closed.
			}
		}
		logInfo(`[ChromePortRPC] Connection dropped (${reason})`);
		scheduleReconnect();
	};

	/** Post a handshake or heartbeat and drop the port if it goes unanswered. */
	const sendControl = (target: chrome.runtime.Port, reason: string): void => {
		clearResponseTimer();
		const id = newControlId();
		controlId = id;
		responseTimer = setTimeout(() => {
			if (port !== target) return;
			if (!ready) unansweredConnects += 1;
			dropPort(reason);
		}, responseTimeoutMs);
		try {
			target.postMessage(serializeForRpc({ id, op: "health", payload: {} }));
		} catch {
			dropPort(`${reason}: post failed`);
		}
	};

	const flushQueue = (): void => {
		while (queue.length > 0 && port && ready) {
			const message = queue[0]!;
			try {
				port.postMessage(serializeForRpc(message));
				queue.shift();
			} catch (error) {
				logWarn("[ChromePortRPC] Failed to send a queued request", error);
				dropPort("send failed");
				return;
			}
		}
	};

	const startHeartbeat = (): void => {
		stopHeartbeat();
		if (heartbeatIntervalMs <= 0) return;
		heartbeatTimer = setInterval(() => {
			if (port && ready && controlId === null) {
				sendControl(port, "no heartbeat answer");
			}
		}, heartbeatIntervalMs);
	};

	function handleMessage(msg: unknown): void {
		if (!isRpcResponse(msg)) return;
		if (msg.id === controlId) {
			clearResponseTimer();
			if (!ready) {
				ready = true;
				unansweredConnects = 0;
				backoff = backoffInit;
				startHeartbeat();
				flushQueue();
			}
			return;
		}
		for (const fn of subscribers) fn(msg);
	}

	function handleDisconnect(): void {
		// Reading lastError marks it handled ("Receiving end does not exist").
		void chrome.runtime.lastError;
		if (!ready) unansweredConnects += 1;
		dropPort("disconnected");
	}

	let connecting: Promise<void> | null = null;

	function connect(): Promise<void> {
		connecting ??= openPort().finally(() => {
			connecting = null;
		});
		return connecting;
	}

	async function openPort(): Promise<void> {
		if (disposed || port) return;
		if (unansweredConnects > 0 && ensureOffscreen) {
			try {
				await ensureOffscreen();
			} catch {
				// The background may be restarting; the next attempt asks again.
			}
			if (disposed || port) return;
		}
		try {
			const next = chrome.runtime.connect({ name: channelName });
			next.onMessage.addListener(handleMessage);
			next.onDisconnect.addListener(handleDisconnect);
			port = next;
			ready = false;
			sendControl(next, "no handshake answer");
		} catch (error) {
			logWarn("[ChromePortRPC] Connection failed, will retry", error);
			port = null;
			unansweredConnects += 1;
			scheduleReconnect();
		}
	}

	await connect();

	const transport: RpcTransport = {
		post(msg: RpcRequest): void {
			if (disposed) return;
			queue.push(msg);
			if (port && ready) {
				flushQueue();
			} else if (!port && !reconnectTimer) {
				void connect();
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
