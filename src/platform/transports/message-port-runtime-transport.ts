import type { RuntimeTransport } from "../contracts/core";
import {
	RUNTIME_PROTOCOL,
	isRuntimeHostMessage,
	type RuntimeClientMessage,
	type RuntimeHostMessage,
} from "./message-port-runtime-protocol";

type RuntimePort = Pick<
	MessagePort,
	"postMessage" | "addEventListener" | "removeEventListener" | "start" | "close"
>;

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout>;
	removeAbort?: () => void;
}

interface StreamState {
	queue: unknown[];
	wake: (() => void) | null;
	done: boolean;
	error: Error | null;
	expectedSequence: number;
	removeAbort?: () => void;
}

export interface MessagePortRuntimeTransportOptions {
	requestTimeoutMs?: number;
}

function abortError(message = "Operation aborted"): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

export class MessagePortRuntimeTransport implements RuntimeTransport {
	private readonly pending = new Map<number, PendingRequest>();
	private readonly streams = new Map<number, StreamState>();
	private readonly timeoutMs: number;
	private nextId = 0;
	private closed = false;

	constructor(
		private readonly port: RuntimePort,
		options: MessagePortRuntimeTransportOptions = {},
	) {
		this.timeoutMs = options.requestTimeoutMs ?? 30_000;
		this.port.addEventListener("message", this.onMessage as EventListener);
		this.port.start();
	}

	request<T>(
		method: string,
		params: unknown,
		signal?: AbortSignal,
	): Promise<T> {
		this.ensureOpen();
		if (signal?.aborted) return Promise.reject(abortError());
		const id = this.allocateId();

		return new Promise<T>((resolve, reject) => {
			const pending: PendingRequest = {
				resolve: (value) => resolve(value as T),
				reject,
			};
			if (this.timeoutMs > 0) {
				pending.timer = setTimeout(() => {
					this.pending.delete(id);
					pending.removeAbort?.();
					this.send({ protocol: RUNTIME_PROTOCOL, type: "cancel", id });
					reject(
						new Error(
							`Runtime request "${method}" timed out after ${this.timeoutMs}ms`,
						),
					);
				}, this.timeoutMs);
			}
			pending.removeAbort = this.listenForAbort(signal, () => {
				this.pending.delete(id);
				this.clearPending(pending);
				this.send({ protocol: RUNTIME_PROTOCOL, type: "cancel", id });
				reject(abortError());
			});
			this.pending.set(id, pending);
			this.send({
				protocol: RUNTIME_PROTOCOL,
				type: "request",
				id,
				mode: "request",
				method,
				params,
			});
		});
	}

	stream<T>(
		method: string,
		params: unknown,
		signal?: AbortSignal,
	): AsyncIterable<T> {
		this.ensureOpen();
		const id = this.allocateId();
		const state: StreamState = {
			queue: [],
			wake: null,
			done: false,
			error: signal?.aborted ? abortError() : null,
			expectedSequence: 0,
		};
		state.removeAbort = this.listenForAbort(signal, () => {
			state.error = abortError();
			state.done = true;
			this.send({ protocol: RUNTIME_PROTOCOL, type: "cancel", id });
			state.wake?.();
		});
		this.streams.set(id, state);
		if (!state.done) {
			this.send({
				protocol: RUNTIME_PROTOCOL,
				type: "request",
				id,
				mode: "stream",
				method,
				params,
			});
		}

		const transport = this;
		return {
			async *[Symbol.asyncIterator](): AsyncIterator<T> {
				try {
					while (true) {
						while (state.queue.length > 0) yield state.queue.shift() as T;
						if (state.error) throw state.error;
						if (state.done) return;
						await new Promise<void>((resolve) => {
							state.wake = resolve;
						});
						state.wake = null;
					}
				} finally {
					if (!state.done) {
						transport.send({ protocol: RUNTIME_PROTOCOL, type: "cancel", id });
					}
					state.removeAbort?.();
					transport.streams.delete(id);
				}
			},
		};
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.port.removeEventListener("message", this.onMessage as EventListener);

		const error = new Error("Runtime transport closed");
		for (const pending of this.pending.values()) {
			this.clearPending(pending);
			pending.reject(error);
		}
		this.pending.clear();
		for (const state of this.streams.values()) {
			state.error = error;
			state.done = true;
			state.removeAbort?.();
			state.wake?.();
		}
		this.streams.clear();
		this.port.close();
	}

	private readonly onMessage = (event: MessageEvent<unknown>): void => {
		if (!isRuntimeHostMessage(event.data)) return;
		const message: RuntimeHostMessage = event.data;
		if (message.type === "response") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			this.clearPending(pending);
			if (message.ok) pending.resolve(message.result);
			else pending.reject(new Error(message.error ?? "Runtime request failed"));
			return;
		}

		const state = this.streams.get(message.id);
		if (!state || state.done) return;
		if (message.type === "stream-item") {
			if (message.sequence !== state.expectedSequence) {
				state.error = new Error(
					`Out-of-order runtime stream: expected ${state.expectedSequence}, received ${message.sequence}`,
				);
				state.done = true;
			} else {
				state.expectedSequence += 1;
				state.queue.push(message.value);
			}
		} else {
			state.done = true;
			if (!message.ok)
				state.error = new Error(message.error ?? "Runtime stream failed");
		}
		state.wake?.();
	};

	private allocateId(): number {
		this.nextId += 1;
		return this.nextId;
	}

	private ensureOpen(): void {
		if (this.closed) throw new Error("Runtime transport is closed");
	}

	private send(message: RuntimeClientMessage): void {
		if (!this.closed) this.port.postMessage(message);
	}

	private listenForAbort(
		signal: AbortSignal | undefined,
		listener: () => void,
	): (() => void) | undefined {
		if (!signal) return undefined;
		signal.addEventListener("abort", listener, { once: true });
		return () => signal.removeEventListener("abort", listener);
	}

	private clearPending(pending: PendingRequest): void {
		if (pending.timer) clearTimeout(pending.timer);
		pending.removeAbort?.();
	}
}

export { abortError, toError };
