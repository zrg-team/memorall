export type RowMode = "array" | "object";

export interface QueryOptions {
	rowMode?: RowMode;
}
export interface QueryResult<R = unknown> {
	rows: R[];
	rowCount?: number;
}

/** RPC ops supported by the server-side handler */
export type RpcOp = "health" | "query" | "exec" | "transaction" | "close";

export interface RpcRequest {
	id: number;
	op: RpcOp;
	/** Payload shape depends on op */
	payload?: unknown;
}
interface RpcResponseOk<T = unknown> {
	id: number;
	ok: true;
	data: T;
}
interface RpcResponseErr {
	id: number;
	ok: false;
	error: string;
}
export type RpcResponse<T = unknown> = RpcResponseOk<T> | RpcResponseErr;

/** Payload/Result contracts for each op */
export interface WorkerQueryPayload {
	sql: string;
	params?: unknown[];
	rowMode?: RowMode;
}
export interface WorkerQueryResult<R = unknown> {
	rows: R[];
	rowCount?: number;
}
export interface WorkerExecPayload {
	sql: string;
}
interface WorkerTxnStmt {
	sql: string;
	params?: unknown[];
	rowMode?: RowMode;
}
interface WorkerTxnPayload {
	stmts: WorkerTxnStmt[];
}

/** Abstract transport the proxy uses to talk to your backend. */
export interface RpcTransport {
	/**
	 * Send a message to the backend.
	 * Implementations SHOULD be non-blocking and may buffer messages.
	 */
	post(msg: RpcRequest): void;

	/**
	 * Subscribe to incoming messages. Return an unsubscribe function.
	 * The transport MUST deliver only responses intended for this runtime.
	 */
	subscribe(handler: (msg: RpcResponse) => void): () => void;
}
