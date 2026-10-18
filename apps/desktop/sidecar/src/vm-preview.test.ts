import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { previewHtmlBridge, VmPreview } from "./vm-preview";
import type { VmRpc } from "./vm-wire";

// A real HTTP peer behind the multiplexed guest transport, including flow
// control. This catches HTTP Agent and upgrade bugs that RPC spies miss.
class Guest extends EventEmitter {
	connections = new Map<string, Socket>();
	async request(operation: string, payload: any) {
		if (operation === "tunnel.open") {
			const channel = crypto.randomUUID();
			const socket = connect(payload.port, "127.0.0.1");
			await once(socket, "connect");
			socket.on("data", (data) => {
				socket.pause();
				this.emit("event", { channel, data: data.toString("base64") });
			});
			socket.pause();
			socket.on("error", () => undefined);
			socket.on("end", () => this.emit("event", { channel, closed: true }));
			this.connections.set(channel, socket);
			return { channel };
		}
		const socket = this.connections.get(payload.channel);
		if (operation === "tunnel.write")
			socket?.write(Buffer.from(payload.data, "base64"));
		if (operation === "tunnel.start" || operation === "tunnel.resume")
			socket?.resume();
		if (operation === "tunnel.close") {
			socket?.destroy();
			this.connections.delete(payload.channel);
		}
		return {};
	}
	close() {
		for (const socket of this.connections.values()) socket.destroy();
	}
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
describe("desktop preview HTTP boundary", () => {
	it("preserves the document mode and split UTF-8 bytes", async () => {
		const stream = previewHtmlBridge();
		const chunks: Buffer[] = [];
		stream.on("data", (data) => chunks.push(data));
		stream.write("<!doctype html><html><he");
		stream.write("ad>");
		stream.end("<title>λ</title></head><body>ok</body></html>");
		await once(stream, "end");
		const html = Buffer.concat(chunks).toString();
		expect(html).toMatch(/^<!doctype html><html><head><script/);
		expect(html).toContain("<title>λ</title>");
	});
	it("requires a capability, supports iframe assets without third-party cookies, and keeps application cookies", async () => {
		let receivedCookie = "";
		const upstream = createServer((req, res) => {
			receivedCookie = req.headers.cookie ?? "";
			res.setHeader("Content-Type", "text/html");
			res.setHeader("Set-Cookie", "app_session=works; Path=/; HttpOnly");
			res.end("<!doctype html><html><head></head><body>hello</body></html>");
		});
		upstream.listen(0, "127.0.0.1");
		await once(upstream, "listening");
		cleanups.push(() => {
			upstream.closeAllConnections();
			upstream.close();
		});
		const guest = new Guest();
		cleanups.push(() => guest.close());
		const preview = new VmPreview(
			guest as unknown as VmRpc,
			"window.bridgeReady=true;",
		);
		cleanups.push(() => preview.stop());
		const url = await preview.url(
			(upstream.address() as { port: number }).port,
		);
		const initial = await fetch(url);
		expect(initial.status).toBe(200);
		expect(await initial.text()).toMatch(/^<!doctype html>/);
		const cookies = initial.headers.getSetCookie();
		expect(cookies).toHaveLength(2);
		const bare = new URL("/", url);
		expect((await fetch(bare)).status).toBe(403);
		expect(
			(
				await fetch(bare, {
					headers: {
						origin: "https://attacker.test",
						"sec-fetch-site": "cross-site",
					},
				})
			).status,
		).toBe(403);
		const inside = await fetch(bare, {
			headers: {
				"sec-fetch-site": "same-origin",
				cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "),
			},
		});
		expect(inside.status).toBe(200);
		await inside.text();
		expect(receivedCookie).toBe("app_session=works");
		const asset = await fetch(new URL("/__memorall_preview_bridge.js", url), {
			headers: { "sec-fetch-site": "same-origin" },
		});
		expect(await asset.text()).toBe("window.bridgeReady=true;");
		await expect(preview.url(3128)).rejects.toThrow("Invalid preview port");
	});
	it("forwards WebSockets and closes upgraded connections on stop", async () => {
		const upstream = createServer();
		upstream.on("upgrade", (req, socket) => {
			expect(req.url).toBe("/hmr");
			const accept = createHash("sha1")
				.update(
					req.headers["sec-websocket-key"] +
						"258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
				)
				.digest("base64");
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
			);
			socket.write(
				Buffer.concat([Buffer.from([0x81, 5]), Buffer.from("hello")]),
			);
		});
		upstream.listen(0, "127.0.0.1");
		await once(upstream, "listening");
		cleanups.push(() => {
			upstream.closeAllConnections();
			upstream.close();
		});
		const guest = new Guest();
		cleanups.push(() => guest.close());
		const preview = new VmPreview(guest as unknown as VmRpc, "");
		cleanups.push(() => preview.stop());
		const target = new URL(
			await preview.url((upstream.address() as { port: number }).port, "/hmr"),
		);
		target.protocol = "ws:";
		const websocket = new WebSocket(target);
		const message = await new Promise<MessageEvent>((resolve, reject) => {
			websocket.onmessage = resolve;
			websocket.onerror = reject;
		});
		expect(message.data).toBe("hello");
		const closed = new Promise((resolve) => {
			websocket.onclose = resolve;
		});
		await preview.stop();
		await closed;
	});
});
