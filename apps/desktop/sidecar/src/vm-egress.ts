import { connect, type Socket } from "node:net";
import type { VmRpc } from "./vm-wire";

/** Multiplexes guest proxy streams over the private virtio control channel.
 * There is deliberately no guest NIC, host route, DNS bypass, or host process
 * per connection. A guest can reach only the policy-enforcing HTTP proxy.
 */
export class VmEgressTransport {
	private channels = new Map<string, Socket>();
	constructor(
		private rpc: VmRpc,
		private port: number,
	) {
		rpc.on("event", this.onEvent);
	}
	private onEvent = (event: {
		kind?: string;
		channel?: string;
		data?: string;
	}) => {
		const channel = event.channel;
		if (
			!event.kind?.startsWith("egress.") ||
			typeof channel !== "string" ||
			channel.length > 100
		)
			return;
		if (event.kind === "egress.open") {
			if (this.channels.size >= 32 || this.channels.has(channel)) {
				this.reply("egress.close", { channel });
				return;
			}
			const socket = connect({ host: "127.0.0.1", port: this.port });
			this.channels.set(channel, socket);
			socket.once("connect", () => this.reply("egress.ready", { channel }));
			socket.on("data", (data) => {
				socket.pause();
				void this.rpc
					.request(
						"egress.data",
						{ channel, data: data.toString("base64") },
						60_000,
					)
					.then(
						() => socket.resume(),
						() => socket.destroy(),
					);
			});
			socket.once("error", () => socket.destroy());
			socket.once("close", () => {
				this.channels.delete(channel);
				this.reply("egress.close", { channel });
			});
		} else if (
			event.kind === "egress.data" &&
			typeof event.data === "string" &&
			event.data.length < 65536
		) {
			this.channels.get(channel)?.write(Buffer.from(event.data, "base64"));
		} else if (event.kind === "egress.close")
			this.channels.get(channel)?.destroy();
	};
	private reply(operation: string, payload: unknown): void {
		void this.rpc.request(operation, payload, 10000).catch(() => undefined);
	}
	stop(): void {
		this.rpc.off("event", this.onEvent);
		for (const socket of this.channels.values()) socket.destroy();
		this.channels.clear();
	}
}
