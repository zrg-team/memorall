import {
	RUNTIME_PROTOCOL,
	isRuntimeClientMessage,
	type RuntimeRequestMessage,
	type RuntimeHostMessage,
} from "./message-port-runtime-protocol";

type RuntimePort = Pick<
	MessagePort,
	"postMessage" | "addEventListener" | "removeEventListener" | "start" | "close"
>;

export interface RuntimeRequestContext {
	signal: AbortSignal;
}

export type RuntimeRequestHandler = (
	params: unknown,
	context: RuntimeRequestContext,
) => unknown | Promise<unknown> | AsyncIterable<unknown>;

export type RuntimeRequestHandlers = Record<string, RuntimeRequestHandler>;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return (
		typeof value === "object" && value !== null && Symbol.asyncIterator in value
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class MessagePortRuntimeHost {
	private readonly operations = new Map<number, AbortController>();
	private closed = false;

	constructor(
		private readonly port: RuntimePort,
		private readonly handlers: RuntimeRequestHandlers,
	) {
		this.port.addEventListener("message", this.onMessage as EventListener);
		this.port.start();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.port.removeEventListener("message", this.onMessage as EventListener);
		for (const controller of this.operations.values()) controller.abort();
		this.operations.clear();
		this.port.close();
	}

	private readonly onMessage = (event: MessageEvent<unknown>): void => {
		if (!isRuntimeClientMessage(event.data)) return;
		const message = event.data;
		if (message.type === "cancel") {
			this.operations.get(message.id)?.abort();
			return;
		}

		const handler = this.handlers[message.method];
		if (!handler) {
			this.reply({
				protocol: RUNTIME_PROTOCOL,
				type: message.mode === "stream" ? "stream-end" : "response",
				id: message.id,
				ok: false,
				error: `Unknown runtime method: ${message.method}`,
			});
			return;
		}

		const controller = new AbortController();
		this.operations.set(message.id, controller);
		void this.execute(message, handler, controller);
	};

	private async execute(
		message: RuntimeRequestMessage,
		handler: RuntimeRequestHandler,
		controller: AbortController,
	): Promise<void> {
		try {
			const result = await handler(message.params, {
				signal: controller.signal,
			});
			if (message.mode === "stream") {
				let sequence = 0;
				if (isAsyncIterable(result)) {
					for await (const value of result) {
						if (controller.signal.aborted) break;
						this.reply({
							protocol: RUNTIME_PROTOCOL,
							type: "stream-item",
							id: message.id,
							sequence,
							value,
						});
						sequence += 1;
					}
				} else if (!controller.signal.aborted) {
					this.reply({
						protocol: RUNTIME_PROTOCOL,
						type: "stream-item",
						id: message.id,
						sequence,
						value: result,
					});
				}
				this.reply({
					protocol: RUNTIME_PROTOCOL,
					type: "stream-end",
					id: message.id,
					ok: !controller.signal.aborted,
					error: controller.signal.aborted ? "Operation aborted" : undefined,
				});
			} else {
				if (isAsyncIterable(result)) {
					throw new Error(
						`Runtime method ${message.method} returned a stream for a request`,
					);
				}
				this.reply({
					protocol: RUNTIME_PROTOCOL,
					type: "response",
					id: message.id,
					ok: true,
					result,
				});
			}
		} catch (error) {
			this.reply({
				protocol: RUNTIME_PROTOCOL,
				type: message.mode === "stream" ? "stream-end" : "response",
				id: message.id,
				ok: false,
				error: errorMessage(error),
			});
		} finally {
			this.operations.delete(message.id);
		}
	}

	private reply(message: RuntimeHostMessage): void {
		if (!this.closed) this.port.postMessage(message);
	}
}
