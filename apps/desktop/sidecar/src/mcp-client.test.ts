import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { StreamableHttpMcpClient } from "./mcp-client";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve) => server.close(() => resolve())),
			),
	);
});

describe("StreamableHttpMcpClient", () => {
	it("initializes, keeps the MCP session id, and parses fragmented SSE data", async () => {
		const seenSessions: Array<string | undefined> = [];
		const server = createServer((request, response) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				seenSessions.push(
					request.headers["mcp-session-id"] as string | undefined,
				);
				if (request.method === "DELETE") {
					response.writeHead(204).end();
					return;
				}
				const message = JSON.parse(body) as { id?: number; method?: string };
				if (message.method === "notifications/initialized") {
					response.writeHead(202).end();
					return;
				}
				response.writeHead(200, {
					"content-type": "text/event-stream",
					"mcp-session-id": "session-7",
				});
				const payload =
					message.method === "initialize"
						? {
								jsonrpc: "2.0",
								id: message.id,
								result: { protocolVersion: "2025-03-26" },
							}
						: {
								jsonrpc: "2.0",
								id: message.id,
								result: { tools: [{ name: "tabs" }] },
							};
				const frame = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
				response.write(frame.slice(0, 9));
				response.end(frame.slice(9));
			});
		});
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Server did not bind.");
		const client = new StreamableHttpMcpClient(
			`http://127.0.0.1:${address.port}/mcp`,
		);

		await expect(client.listTools()).resolves.toEqual(new Set(["tabs"]));
		expect(seenSessions).toEqual([undefined, "session-7", "session-7"]);
		await client.close();
		expect(seenSessions.at(-1)).toBe("session-7");
	});

	it("surfaces JSON-RPC errors with stable codes", async () => {
		const server = createServer((request, response) => {
			request.resume();
			request.on("end", () => {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						error: { code: -32600, message: "bad initialize" },
					}),
				);
			});
		});
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Server did not bind.");
		const client = new StreamableHttpMcpClient(
			`http://127.0.0.1:${address.port}/mcp`,
		);

		await expect(client.initialize()).rejects.toMatchObject({
			code: "MCP_REQUEST_FAILED",
			message: "bad initialize",
		});
	});
});
