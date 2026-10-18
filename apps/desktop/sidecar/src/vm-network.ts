import { lookup } from "node:dns/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";

const denied = new BlockList();
const denied6 = new BlockList();
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	denied.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["2001::", 23],
	["2002::", 16],
	["3fff::", 20],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const)
	denied6.addSubnet(network, prefix, "ipv6");
export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	return family === 4
		? !denied.check(address, "ipv4")
		: family === 6
			? global6.check(address, "ipv6") && !denied6.check(address, "ipv6")
			: false;
}
export async function publicDestination(host: string): Promise<string> {
	host = host.replace(/^\[|\]$/g, "");
	const addresses = isIP(host)
		? [{ address: host }]
		: await lookup(host, { all: true });
	if (
		!addresses.length ||
		addresses.some(({ address }) => !isPublicAddress(address))
	)
		throw new Error(
			"Sandbox network policy blocks private, local, or reserved addresses",
		);
	// Pin the checked address, while preferring IPv4 on hosts whose DNS returns
	// AAAA first despite having no usable IPv6 route.
	return (addresses.find(({ address }) => isIP(address) === 4) ?? addresses[0])!
		.address;
}

/** The guest has no routed network. Its only outbound path is this proxy. */
export class VmEgressProxy {
	readonly stats = { connections: 0, http: 0, connect: 0, denied: 0 };
	private server: Server | null = null;
	private sockets = new Set<Socket>();
	async start(): Promise<number> {
		const server = createServer((req, res) => {
			this.stats.http++;
			void (async () => {
				const url = new URL(req.url ?? "");
				if (
					url.protocol !== "http:" ||
					url.username ||
					url.password ||
					(url.port && url.port !== "80")
				)
					throw new Error("Only public HTTP and HTTPS are allowed");
				const address = await publicDestination(url.hostname);
				if (this.server !== server) throw new Error("Sandbox proxy stopped");
				const {
					"proxy-authorization": _auth,
					"proxy-connection": _connection,
					...headers
				} = req.headers;
				const upstream = httpRequest(
					{
						host: address,
						port: 80,
						method: req.method,
						path: url.pathname + url.search,
						headers: { ...headers, host: url.host },
						timeout: 60_000,
					},
					(response) => {
						res.writeHead(response.statusCode ?? 502, response.headers);
						response.pipe(res);
					},
				);
				upstream.on("timeout", () =>
					upstream.destroy(new Error("Upstream timed out")),
				);
				upstream.on("socket", (socket) => this.track(socket));
				res.once("close", () => upstream.destroy());
				upstream.on("error", () => {
					if (!res.headersSent) res.writeHead(502);
					res.end();
				});
				req.on("aborted", () => upstream.destroy());
				req.pipe(upstream);
			})().catch(() => {
				this.stats.denied++;
				res.writeHead(403);
				res.end("Sandbox network policy denied this destination");
			});
		});
		server.on("connect", (req, client, head) => {
			this.stats.connect++;
			void (async () => {
				const url = new URL(`http://${req.url}`);
					// URL normalizes an explicit :80 to an empty port. Undici
					// uses CONNECT for plain HTTP too, so retain its default here.
					const port = Number(url.port || 80);
					if (![80, 443].includes(port) || url.username || url.password)
					throw new Error(
						"Only CONNECT on public web ports 80 and 443 is allowed",
					);
				const address = await publicDestination(url.hostname);
				if (this.server !== server) throw new Error("Sandbox proxy stopped");
					const upstream = connect({ host: address, port });
				this.track(upstream);
				upstream.setTimeout(120_000, () => upstream.destroy());
				upstream.once("connect", () => {
					client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
					if (head.length) upstream.write(head);
					client.pipe(upstream);
					upstream.pipe(client);
				});
				client.once("close", () => upstream.destroy());
				upstream.on("error", () => client.destroy());
			})().catch(() => {
				this.stats.denied++;
				client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
			});
		});
		server.on("connection", (socket) => {
			this.stats.connections++;
			this.track(socket);
		});
		server.on("clientError", (_error, socket) => socket.destroy());
		server.headersTimeout = 15_000;
		server.requestTimeout = 120_000;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		this.server = server;
		return (server.address() as { port: number }).port;
	}
	private track(socket: Socket): void {
		this.sockets.add(socket);
		socket.once("close", () => this.sockets.delete(socket));
	}
	async stop(): Promise<void> {
		for (const socket of this.sockets) socket.destroy();
		const server = this.server;
		this.server = null;
		if (server)
			await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}
