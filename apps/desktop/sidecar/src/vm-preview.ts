import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	Agent,
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type Server,
} from "node:http";
import { Duplex, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import type { VmRpc } from "./vm-wire";

class GuestSocket extends Duplex {
	private channel = "";
	private onEvent = (event: {
		channel?: string;
		data?: string;
		closed?: boolean;
	}) => {
		if (event.channel !== this.channel) return;
		if (
			typeof event.data === "string" &&
			this.push(Buffer.from(event.data, "base64"))
		)
			this.resumeGuest();
		if (event.closed) this.push(null);
	};
	constructor(
		private rpc: VmRpc,
		private port: number,
	) {
		super();
	}
	async open(): Promise<this> {
		this.channel = (
			await this.rpc.request("tunnel.open", { port: this.port })
		).channel;
		this.rpc.on("event", this.onEvent);
		await this.rpc.request("tunnel.start", { channel: this.channel });
		return this;
	}
	private resumeGuest(): void {
		if (this.channel)
			void this.rpc
				.request("tunnel.resume", { channel: this.channel }, 10_000)
				.catch((error) => this.destroy(error));
	}
	_read(): void {
		this.resumeGuest();
	}
	_write(
		chunk: Buffer,
		_encoding: string,
		callback: (error?: Error | null) => void,
	): void {
		this.rpc
			.request("tunnel.write", {
				channel: this.channel,
				data: chunk.toString("base64"),
			})
			.then(() => callback(), callback);
	}
	_destroy(
		error: Error | null,
		callback: (error?: Error | null) => void,
	): void {
		this.rpc.off("event", this.onEvent);
		if (this.channel)
			void this.rpc
				.request("tunnel.close", { channel: this.channel }, 5_000)
				.catch(() => undefined);
		callback(error);
	}
	setTimeout(): this {
		return this;
	}
	setNoDelay(): this {
		return this;
	}
	setKeepAlive(): this {
		return this;
	}
}

/** Preserve the doctype and inject before application scripts, including pages
 * whose first network chunk splits the opening head element. */
export function previewHtmlBridge(): Transform {
	let prefix = Buffer.alloc(0);
	let injected = false;
	const insert = (buffer: Buffer) => {
		const text = buffer.toString("utf8");
		const head = /<head\b[^>]*>/i.exec(text);
		const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
		const position = head
			? head.index + head[0].length
			: doctype
				? doctype[0].length
				: 0;
		const bytes = Buffer.byteLength(text.slice(0, position));
		return Buffer.concat([
			buffer.subarray(0, bytes),
			Buffer.from('<script src="/__memorall_preview_bridge.js"></script>'),
			buffer.subarray(bytes),
		]);
	};
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			if (injected) {
				callback(null, chunk);
				return;
			}
			prefix = Buffer.concat([prefix, chunk]);
			if (
				/<head\b[^>]*>/i.test(prefix.toString("utf8")) ||
				prefix.length >= 8192
			) {
				injected = true;
				callback(null, insert(prefix));
			} else callback();
		},
		flush(callback) {
			if (!injected) this.push(insert(prefix));
			callback();
		},
	});
}

/** An authenticated, separate HTTP origin for each guest preview, including HMR. */
export class VmPreview {
	private servers = new Map<number, { server: Server; url: string }>();
	private sockets = new Set<Duplex>();
	constructor(
		private rpc: VmRpc,
		private bridgeSource?: string,
	) {}
	async url(port: number, path = "/"): Promise<string> {
		if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3128)
			throw new Error("Invalid preview port");
		let active = this.servers.get(port);
		if (!active) {
			const bridge =
				this.bridgeSource ??
				(await readFile(
					fileURLToPath(new URL("./desktop-preview.js", import.meta.url)),
					"utf8",
				));
			const token = randomBytes(32).toString("hex");
			const cookie = `memorall_preview_${port}`;
			let authority = "";
			const cleanPath = (input = "/") => {
				const url = new URL(input, `http://${authority}`);
				url.searchParams.delete("__memorall_preview");
				url.searchParams.delete("__memorall_guest_port");
				return url.pathname + url.search;
			};
			const cleanCookie = (input?: string) =>
				input
					?.split(/;\s*/)
					.filter((entry) => !entry.startsWith("memorall_preview_"))
					.join("; ");
			const authorized = (req: IncomingMessage) =>
				req.headers.host === authority &&
				(new URL(req.url ?? "/", `http://${authority}`).searchParams.get(
					"__memorall_preview",
				) === token ||
					(req.headers.cookie ?? "")
						.split(/;\s*/)
						.includes(`${cookie}=${token}`) ||
					req.headers.origin === `http://${authority}` ||
					(req.headers["sec-fetch-site"] === "same-origin" &&
						!req.headers.origin));
			const server = createServer((req, res) => {
				if (req.headers.host !== authority) {
					res.writeHead(403);
					res.end();
					return;
				}
				const url = new URL(req.url ?? "/", `http://${authority}`);
				if (!authorized(req)) {
					res.writeHead(403);
					res.end("Open this preview from Memorall");
					return;
				}
				if (url.searchParams.get("__memorall_preview") === token)
					res.setHeader(
						"Set-Cookie",
						`${cookie}=${token}; HttpOnly; SameSite=Lax; Path=/`,
					);
				url.searchParams.delete("__memorall_preview");
				url.searchParams.delete("__memorall_guest_port");
				if (url.pathname === "/__memorall_preview_bridge.js") {
					res.writeHead(200, {
						"Content-Type": "application/javascript",
						"Cache-Control": "no-store",
					});
					res.end(bridge);
					return;
				}
				const requestHeaders = { ...req.headers };
				delete requestHeaders.cookie;
				const applicationCookie = cleanCookie(req.headers.cookie);
				if (applicationCookie) requestHeaders.cookie = applicationCookie;
				const agent = new Agent({ keepAlive: false });
				agent.createConnection = ((
					_options: unknown,
					callback: (error: Error | null, socket?: Duplex) => void,
				) => {
					new GuestSocket(this.rpc, port)
						.open()
						.then((socket) => callback(null, socket), callback);
					return undefined;
				}) as any;
				const upstream = httpRequest(
					{
						host: "127.0.0.1",
						port,
						path: url.pathname + url.search,
						method: req.method,
						headers: { ...requestHeaders, "accept-encoding": "identity" },
						agent,
					},
					(response) => {
						const headers = { ...response.headers };
						// The capability cookie belongs to the supervisor. Guest app
						// cookies still work, without replacing it or receiving it.
						const guestCookies =
							response.headers["set-cookie"]
								?.filter((value) => !/^memorall_preview_/i.test(value))
								.map((value) => value.replace(/;\s*domain=[^;]+/gi, "")) ?? [];
						const capabilityCookie = res.getHeader("Set-Cookie");
						const cookies = [
							...(typeof capabilityCookie === "string"
								? [capabilityCookie]
								: []),
							...guestCookies,
						];
						if (cookies.length) headers["set-cookie"] = cookies;
						else delete headers["set-cookie"];
						if (headers.location) {
							const next = new URL(headers.location, `http://${authority}`);
							if (
								next.origin === `http://${authority}` ||
								((next.hostname === "127.0.0.1" ||
									next.hostname === "localhost") &&
									next.port === String(port))
							) {
								next.searchParams.set("__memorall_preview", token);
								next.searchParams.set("__memorall_guest_port", String(port));
								headers.location = next.pathname + next.search;
							}
						}
						if (
							req.method !== "HEAD" &&
							String(headers["content-type"]).includes("text/html") &&
							!headers["content-encoding"]
						) {
							delete headers["content-length"];
							delete headers["content-security-policy"];
							delete headers["x-frame-options"];
							res.writeHead(response.statusCode ?? 502, headers);
							// Inject before the page's scripts; no parent-app privileges cross this origin.
							const transform = previewHtmlBridge();
							response.on("error", () => transform.destroy());
							transform.on("error", () => res.destroy());
							response.pipe(transform).pipe(res);
						} else {
							res.writeHead(response.statusCode ?? 502, headers);
							response.pipe(res);
						}
					},
				);
				upstream.on("error", (error) => {
					if (!res.headersSent) res.writeHead(502);
					res.end(`Guest preview is not responding: ${error.message}`);
				});
				res.on("close", () => agent.destroy());
				req.on("aborted", () => upstream.destroy());
				req.pipe(upstream);
			});
			server.on("upgrade", (req, socket, head) => {
				if (!authorized(req)) {
					socket.destroy();
					return;
				}
				void new GuestSocket(this.rpc, port)
					.open()
					.then((guest) => {
						this.sockets.add(guest);
						guest.once("close", () => this.sockets.delete(guest));
						const headers = Object.entries({
							...req.headers,
							cookie: cleanCookie(req.headers.cookie),
						})
							.filter(([, value]) => value !== undefined)
							.map(
								([name, value]) =>
									`${name}: ${Array.isArray(value) ? value.join(", ") : value}`,
							)
							.join("\r\n");
						guest.write(
							`${req.method} ${cleanPath(req.url)} HTTP/1.1\r\n${headers}\r\n\r\n`,
						);
						if (head.length) guest.write(head);
						socket.pipe(guest);
						guest.pipe(socket);
						socket.on("error", () => guest.destroy());
						guest.on("error", () => socket.destroy());
						socket.on("close", () => guest.destroy());
					})
					.catch(() => socket.destroy());
			});
			server.on("clientError", (_error, socket) => socket.destroy());
			server.on("connection", (socket) => {
				this.sockets.add(socket);
				socket.once("close", () => this.sockets.delete(socket));
			});
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", resolve);
			});
			authority = `127.0.0.1:${(server.address() as { port: number }).port}`;
			active = {
				server,
				url: `http://${authority}/?__memorall_preview=${token}`,
			};
			this.servers.set(port, active);
		}
		const url = new URL(active.url);
		const target = new URL(path, "http://guest");
		url.pathname = target.pathname;
		url.searchParams.set("__memorall_guest_port", String(port));
		for (const [key, value] of target.searchParams)
			if (!key.startsWith("__memorall_")) url.searchParams.set(key, value);
		return url.href;
	}
	async stop(): Promise<void> {
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		for (const { server } of this.servers.values()) {
			server.closeAllConnections();
			server.close();
		}
		this.servers.clear();
	}
}
