import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";

export const MAX_VM_FRAME = 24 * 1024 * 1024;
export class VmGuestRestartError extends Error {
	constructor() {
		super("Sandbox guest service restarted; run the command again");
	}
}
export class VmRpc extends EventEmitter {
	private seq = 0;
	private buffer = "";
	private failure: Error | null = null;
	private instanceId: string | null = null;
	private pending = new Map<
		number,
		{
			resolve(value: any): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
			cleanup(): void;
		}
	>();
	constructor(
		private readonly stream: Duplex,
		private bootstrapping = false,
	) {
		super();
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => {
			this.buffer += chunk;
			while (this.buffer.includes("\n")) {
				const newline = this.buffer.indexOf("\n");
				if (Buffer.byteLength(this.buffer.slice(0, newline)) > MAX_VM_FRAME) {
					stream.destroy(new Error("VM frame exceeds limit"));
					return;
				}
				const line = this.buffer.slice(0, newline);
				this.buffer = this.buffer.slice(newline + 1);
				try {
					const frame = JSON.parse(line);
					if (frame.event) {
						if (
							frame.event.kind === "runtime.ready" &&
							typeof frame.event.instanceId === "string"
						) {
							if (
								this.instanceId &&
								this.instanceId !== frame.event.instanceId
							) {
								const error = new VmGuestRestartError();
								if (this.bootstrapping) this.rejectPending(error);
								else {
									stream.destroy(error);
									return;
								}
							}
							this.instanceId = frame.event.instanceId;
						}
						this.emit("event", frame.event);
						continue;
					}
					const pending = this.pending.get(frame.id);
					if (!pending) continue;
					clearTimeout(pending.timer);
					pending.cleanup();
					this.pending.delete(frame.id);
					if (frame.ok === true) pending.resolve(frame.result);
					else
						pending.reject(
							new Error(
								typeof frame.error === "string"
									? frame.error
									: "VM request failed",
							),
						);
				} catch {
					stream.destroy(new Error("Invalid VM response"));
					return;
				}
			}
			if (Buffer.byteLength(this.buffer) > MAX_VM_FRAME)
				stream.destroy(new Error("VM frame exceeds limit"));
		});
		stream.on("error", (error) => this.fail(error));
		stream.on("close", () => this.fail(new Error("Sandbox VM disconnected")));
	}
	request(
		operation: string,
		payload: unknown = null,
		timeoutMs = 120_000,
		signal?: AbortSignal,
	): Promise<any> {
		if (this.failure) return Promise.reject(this.failure);
		if (signal?.aborted)
			return Promise.reject(new Error("Sandbox request cancelled"));
		const id = ++this.seq;
		return new Promise((resolve, reject) => {
			const cancel = (reason: string) => {
				clearTimeout(timer);
				cleanup();
				this.pending.delete(id);
				if (operation !== "runtime.cancel")
					void this.request("runtime.cancel", { requestId: id }, 10_000).catch(
						() => undefined,
					);
				reject(new Error(reason));
			};
			const onAbort = () => cancel("Sandbox request cancelled");
			const cleanup = () => signal?.removeEventListener("abort", onAbort);
			const timer = setTimeout(
				() => cancel(`Sandbox request timed out: ${operation}`),
				timeoutMs,
			);
			this.pending.set(id, { resolve, reject, timer, cleanup });
			signal?.addEventListener("abort", onAbort, { once: true });
			const data = JSON.stringify({ id, operation, payload }) + "\n";
			if (Buffer.byteLength(data) > MAX_VM_FRAME) {
				clearTimeout(timer);
				cleanup();
				this.pending.delete(id);
				reject(new Error("Sandbox request exceeds transfer limit"));
				return;
			}
			this.stream.write(data, (error) => {
				if (error) this.fail(error);
			});
		});
	}
	completeBootstrap(): void {
		this.bootstrapping = false;
	}
	close(): void {
		this.fail(new Error("Sandbox stopped"));
		this.stream.destroy();
	}
	private fail(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		this.rejectPending(error);
		this.emit("disconnected", error);
	}
	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.cleanup();
			pending.reject(error);
		}
		this.pending.clear();
	}
}
