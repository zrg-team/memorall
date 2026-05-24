import {
	MultiServerMCPClient,
	type StreamableHTTPConnection,
} from "@/lib/langchain-mcp-adapter";
import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type { StepSpecFromDefinition } from "../../../interfaces/step";
import type { BoundStep } from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import { adaptMCPTool } from "./mcp-tool-adapter";
import type { MCPFeatureConfig, MCPServerConfig } from "./types";

const STEP_NAME = "mcp-feature" as const;
export const MCP_FEATURE_NAME = STEP_NAME;

export interface MCPFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface MCPFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export type { MCPFeatureConfig };
export type { MCPServerConfig };

export const MCP_FEATURE_TOOLS: readonly string[] = [];

export const MCP_FEATURE_DESCRIPTION =
	"Connect external MCP (Model Context Protocol) servers and expose their tools to the agent.";

const buildClientServersConfig = (
	servers: MCPServerConfig[],
): Record<string, StreamableHTTPConnection> =>
	Object.fromEntries(
		servers.map((server) => {
			const conn: StreamableHTTPConnection = {
				type: server.type,
				url: server.url,
				...(server.headers ? { headers: server.headers } : {}),
			};
			return [server.name, conn];
		}),
	);

const buildSystemPrompt = (
	toolNames: Array<{ name: string; description: string }>,
	serverNames: string[],
): string => {
	const serverList = serverNames.join(", ");
	const toolList = toolNames
		.map((t) => `- ${t.name}: ${t.description || "(no description)"}`)
		.join("\n");
	return `# MCP TOOLS (${serverList})
You have access to external tools provided via MCP servers: ${serverList}.

## AVAILABLE MCP TOOLS
${toolList || "(no tools loaded)"}

Use these tools when they are the best fit for the task at hand.`;
};

const definition = defineStep<
	MCPFeatureInput,
	MCPFeatureOutput,
	undefined,
	MCPFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config, runLifecycle }) => {
		try {
			const servers = config?.servers ?? [];
			if (servers.length === 0) {
				return { output: { tools: input.tools, messages: input.messages } };
			}

			const clientServers = buildClientServersConfig(servers);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const client = new MultiServerMCPClient({
				mcpServers: clientServers,
				throwOnLoadError: false,
				onConnectionError: "ignore",
			});

			await client.initializeConnections();
			const langchainTools = await client.getTools();

			runLifecycle?.onFinish("mcp-client-close", async () => {
				await client.close();
			});

			const mcpBaseTools = langchainTools.map(adaptMCPTool);
			const serverNames = servers.map((s) => s.name);

			const messages = GraphBase.chat.systemMessage(
				input.messages,
				buildSystemPrompt(mcpBaseTools, serverNames),
			);

			return {
				output: {
					tools: GraphBase.chat.addTool(input.tools, ...mcpBaseTools),
					messages,
				},
			};
		} catch (error) {
			logError("[MCP_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
				},
			};
		}
	},
});

type MCPFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createMCPFeatureStep = (
	_services?: undefined,
	config?: MCPFeatureConfig,
): BoundStep<MCPFeatureInput, MCPFeatureOutput> =>
	bindStep(definition, undefined, config);

stepRegistry.register(STEP_NAME, createMCPFeatureStep, {
	description: MCP_FEATURE_DESCRIPTION,
	configParams: [
		{
			key: "servers",
			type: "array",
			default: [],
			description: "MCP server configurations",
		},
	],
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-mcp-feature",
	name: MCP_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with MCP tool instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with dynamically loaded MCP tools.",
		},
	],
	metadata: {
		description: MCP_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.mcpFeature.description",
		displayName: "MCP Servers",
		nameKey: "flowBuilder.features.mcpFeature.name",
		tools: [...MCP_FEATURE_TOOLS],
		systemPrompt: "",
		customizable: true,
		icon: { name: "Plug", type: "lucide" },
		accentColor: "#64748b",
		hideInGrid: true,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: MCPFeatureSpec;
	}
}
