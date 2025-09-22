import type {
	QueryOptions,
	QueryResult,
	RowMode,
	RpcOp,
	RpcRequest,
	RpcResponse,
	RpcTransport,
	WorkerExecPayload,
	WorkerQueryPayload,
	WorkerQueryResult,
} from "./types";

/* PGliteSharedProxy.ts
 * Strictly-typed proxy that mimics a PGlite client but talks over an
 * injected request/response transport (no SharedWorker URL required).
 *
 * Plug in ANY transport that can send a message and deliver replies
 * (e.g., SharedWorker port, BroadcastChannel broker, runtime messaging, etc.).
 */
export interface TransactionFn<T> {
	(tx: PGliteSharedProxy): Promise<T>;
}

export interface PGliteSharedProxyOptions {
	/** Default row mode when caller doesn't pass one (default: 'object') */
	defaultRowMode?: RowMode;
	/** Reject in-flight RPCs after this many ms (default: 30_000; 0 disables timeouts) */
	requestTimeoutMs?: number;
	/** Ping backend on construct (default: true) */
	eagerHealthCheck?: boolean;
}

/** PGlite-like surface that exactly matches what drizzle-orm/pglite expects */
export interface PGliteLike {
	query<R = unknown>(
		sql: string,
		params?: unknown[],
		options?: QueryOptions,
	): Promise<QueryResult<R>>;
	exec(sql: string): Promise<void>;
	transaction<T>(fn: TransactionFn<T>): Promise<T>;
	waitReady: Promise<void>; // Property, not method - to match real PGlite
	close(): Promise<void>;
}

/**
 * PGliteSharedProxy
 * - Keeps your existing `drizzle(pglite, { schema })` call sites unchanged.
 * - You provide a transport (e.g. wrapping a SharedWorker port, Service Worker, etc.).
 * - Ensures strictly-typed request/response and robust timeout handling.
 */
export class PGliteSharedProxy implements PGliteLike {
	private readonly transport: RpcTransport;
	private readonly defaultRowMode: RowMode;
	private readonly timeoutMs: number;
	private rid = 0;

	private readonly pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: unknown) => void;
			timer?: number;
		}
	>();

	private readonly unsubscribe: () => void;

	// waitReady as a property to match PGlite interface
	public readonly waitReady: Promise<void>;

	constructor(transport: RpcTransport, opts: PGliteSharedProxyOptions = {}) {
		this.transport = transport;

		this.defaultRowMode = opts.defaultRowMode ?? "object";
		this.timeoutMs = opts.requestTimeoutMs ?? 30_000;

		// Bind response handler
		this.unsubscribe = this.transport.subscribe((resp) =>
			this.onResponse(resp),
		);

		// Initialize waitReady as a property
		this.waitReady = this.performHealthCheck();

		// Optional eager probe
		if (opts.eagerHealthCheck ?? true) {
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			this.waitReady;
		}
	}

	/** SELECT/INSERT ... RETURNING, etc. */
	async query<R = unknown>(
		sql: string,
		params: unknown[] = [],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		const payload: WorkerQueryPayload = {
			sql,
			params,
			rowMode: options?.rowMode ?? this.defaultRowMode,
		};
		const res = await this.call<WorkerQueryResult<R>>("query", payload);
		return { rows: res?.rows ?? [], rowCount: res?.rowCount };
	}

	/** DDL or statements where you don't care about returned rows */
	async exec(sql: string): Promise<void> {
		const payload: WorkerExecPayload = { sql };
		await this.call("exec", payload);
	}

	/**
	 * Transaction wrapper: BEGIN → user fn → COMMIT/ROLLBACK.
	 * The backend should serialize requests per-client to avoid interleaving.
	 */
	async transaction<T>(fn: TransactionFn<T>): Promise<T> {
		await this.query("BEGIN");
		try {
			const out = await fn(this);
			await this.query("COMMIT");
			return out;
		} catch (err) {
			try {
				await this.query("ROLLBACK");
			} catch {
				/* ignore rollback error */
			}
			throw err;
		}
	}

	/** Health probe - private method used to initialize waitReady property */
	private async performHealthCheck(): Promise<void> {
		await this.call("health");
	}

	/** Graceful shutdown (advisory; does not tear down the backend) */
	async close(): Promise<void> {
		try {
			await this.call("close");
		} finally {
			// Stop listening; reject any future responses we can't match.
			this.unsubscribe();
			// Reject any still-pending promises:
			this.pending.forEach((waiter, id) => {
				this.clearTimer(waiter);
				waiter.reject(new Error("Proxy closed"));
				this.pending.delete(id);
			});
		}
	}

	// -------------------- internals --------------------

	private onResponse(resp: RpcResponse): void {
		const { id } = resp;
		const waiter = this.pending.get(id);
		if (!waiter) return;

		this.pending.delete(id);
		this.clearTimer(waiter);

		if (resp.ok) {
			waiter.resolve(resp.data);
		} else {
			// resp is RpcResponseErr when ok is false
			const errorResp = resp as { ok: false; error: string };
			waiter.reject(new Error(errorResp.error || "Unknown RPC error"));
		}
	}

	private nextId(): number {
		this.rid = (this.rid + 1) >>> 0; // uint32 rollover
		if (this.rid === 0) this.rid = 1;
		return this.rid;
	}

	private call<T = unknown>(op: RpcOp, payload?: unknown): Promise<T> {
		const id = this.nextId();

		const promise = new Promise<T>((resolve, reject) => {
			const waiter = { resolve, reject } as {
				resolve: (v: unknown) => void;
				reject: (e: unknown) => void;
				timer?: number;
			};

			if (this.timeoutMs > 0) {
				// setTimeout in browsers returns number; Node returns Timeout, but this is browser code.
				// @ts-ignore lib.dom.d.ts: setTimeout returns number
				waiter.timer = setTimeout(() => {
					this.pending.delete(id);
					reject(
						new Error(`RPC timeout after ${this.timeoutMs}ms for op "${op}"`),
					);
				}, this.timeoutMs);
			}

			this.pending.set(id, waiter);
			const req: RpcRequest = { id, op, payload };
			this.transport.post(req);
		});

		return promise;
	}

	private clearTimer(waiter: { timer?: number }): void {
		if (waiter.timer != null) {
			// @ts-ignore lib.dom.d.ts: clearTimeout accepts number
			clearTimeout(waiter.timer);
			waiter.timer = undefined;
		}
	}
}

/* ------------------------------------------------------------------ */
/* Example transports (optional): pick one or write your own.          */
/* ------------------------------------------------------------------ */

/**
 * Transport backed by a MessagePort (e.g., SharedWorker.port or MessageChannel.port1)
 */
export function portTransport(port: MessagePort): RpcTransport {
	port.start();
	const handlers = new Set<(m: RpcResponse) => void>();
	const onMsg = (e: MessageEvent<RpcResponse>) => {
		if (!e.data || typeof e.data !== "object") return;
		handlers.forEach((h) => h(e.data));
	};
	port.addEventListener("message", onMsg);
	return {
		post(msg: RpcRequest) {
			port.postMessage(msg);
		},
		subscribe(handler: (msg: RpcResponse) => void) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
				if (handlers.size === 0) {
					port.removeEventListener("message", onMsg);
				}
			};
		},
	};
}

/**
 * Transport backed by BroadcastChannel (requires your backend to relay responses to this channel)
 * NOTE: You must ensure messages are correctly routed by `id` to the same page.
 */
export function broadcastChannelTransport(
	channel: BroadcastChannel,
): RpcTransport {
	const handlers = new Set<(m: RpcResponse) => void>();
	const onMsg = (e: MessageEvent<RpcResponse>) => {
		if (!e.data || typeof e.data !== "object") return;
		handlers.forEach((h) => h(e.data));
	};
	channel.addEventListener("message", onMsg);
	return {
		post(msg: RpcRequest) {
			channel.postMessage(msg);
		},
		subscribe(handler: (msg: RpcResponse) => void) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
				if (handlers.size === 0) {
					channel.removeEventListener("message", onMsg);
				}
			};
		},
	};
}
