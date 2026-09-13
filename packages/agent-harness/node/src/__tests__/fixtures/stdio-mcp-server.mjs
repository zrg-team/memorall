// A minimal stdio MCP server for tests. Behaviour is chosen by argv:
//   --crash-after-init   exit once the handshake finished and a tool is called
//   --slow-start <ms>    wait before answering anything
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const args = process.argv.slice(2);
const slowStart = args.includes("--slow-start")
	? Number(args[args.indexOf("--slow-start") + 1])
	: 0;
if (slowStart > 0)
	await new Promise((resolve) => setTimeout(resolve, slowStart));

const server = new Server(
	{ name: "fixture", version: "1.0.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "echo",
			description: "Echo the text back",
			inputSchema: {
				type: "object",
				properties: { text: { type: "string" } },
				required: ["text"],
			},
		},
		{
			name: "env",
			description: "Read an environment variable",
			inputSchema: {
				type: "object",
				properties: { name: { type: "string" } },
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
	if (args.includes("--crash-after-init")) process.exit(3);
	const input = request.params.arguments ?? {};
	// Unlisted on purpose, so tool-list assertions stay stable: a long call that
	// reports on stderr whether the client cancelled it.
	if (request.params.name === "sleep") {
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, Number(input.ms ?? 10_000));
			extra.signal.addEventListener("abort", () => {
				clearTimeout(timer);
				process.stderr.write("sleep cancelled\n");
				resolve();
			});
		});
		return { content: [{ type: "text", text: "slept" }] };
	}
	if (request.params.name === "env") {
		return {
			content: [
				{ type: "text", text: process.env[String(input.name)] ?? "<unset>" },
			],
		};
	}
	process.stderr.write(`echo called with ${input.text}\n`);
	return { content: [{ type: "text", text: String(input.text) }] };
});

process.stderr.write("fixture ready\n");
await server.connect(new StdioServerTransport());
