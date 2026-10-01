import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_CONNECTIONS_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["list", "tools", "refresh", "grant", "revoke"])
			.describe(
				"list: the user's connections, numbered, with status and whether you may use them; tools: a connection's tools; refresh: ask it for its tools again; grant/revoke: let this agent use it or stop.",
			),
		connection: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe(
				"tools/refresh/grant/revoke: the connection's number in the list.",
			),
	})
	.describe("View the user's connected apps and which ones this agent uses.");

type Input = z.infer<typeof schema>;

const needConnection = (input: Input): number => {
	if (!input.connection) throw new Error(`${input.action} needs connection.`);
	return input.connection;
};

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	if (input.action === "list") {
		machine.selectConnection(null);
		await machine.openConnections();
		return "Opened Connections.";
	}
	if (!machine.snapshot().connections.items.length) {
		await machine.openConnections();
	}
	const item = machine.connectionAt(needConnection(input));
	switch (input.action) {
		case "tools":
			machine.openWindow("connections");
			machine.selectConnection(item.key);
			return `Showing the tools of ${item.label}.`;
		case "refresh":
			await machine.rediscoverConnection(item.connectionId);
			machine.selectConnection(item.key);
			return `Asked ${item.label} for its tools again.`;
		case "grant":
		case "revoke": {
			const granted = input.action === "grant";
			await machine.setConnectionGranted(item.key, granted);
			return granted
				? `This agent may now use ${item.label}; its tools arrive with the next message.`
				: `This agent no longer uses ${item.label}, from the next message.`;
		}
	}
};

export const createMemonConnectionsTool: ToolFactory<
	Input
> = (): Tool<Input> => ({
	name: MEMON_CONNECTIONS_TOOL,
	description:
		"See the user's connected apps (Composio apps, MCP servers), their status and tools, and (when the user asks) grant or revoke them for this agent.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_CONNECTIONS_TOOL,
			context,
			`Connections: ${input.action}`,
			(machine) => ({ windowId: machine.findWindow("connections")?.id }),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_CONNECTIONS_TOOL, createMemonConnectionsTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_CONNECTIONS_TOOL]: { input: Input; services: void };
	}
}
