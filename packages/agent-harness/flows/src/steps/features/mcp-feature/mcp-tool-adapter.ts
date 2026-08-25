import type {
	McpClientManager,
	McpToolDescriptor,
} from "@memorall/agent-harness-mcp";
import { normalizeMcpToolResult } from "@memorall/agent-harness-mcp";
import {
	jsonToolSchema,
	type BaseTool,
	type ToolExecutionResult,
	type ToolResultValue,
} from "../../../interfaces/engine/tool.js";

/**
 * An MCP tool, as the flow graph's tool contract.
 *
 * The descriptor and the call both come from `@memorall/agent-harness-mcp`;
 * this only restates them in the shape the graph already runs. Discovery,
 * schema normalization, transport fallback and result reduction all live in the
 * package, so the app keeps no MCP client of its own.
 */

/**
 * Output-schema validation policy for Memorall's MCP clients.
 *
 * The SDK compiles a validator for every tool that declares an `outputSchema`
 * and rejects a response that does not match. Real servers routinely return
 * payloads their own published schema does not describe — Composio's router
 * among them — and failing the call is strictly worse for the user than handing
 * the model a response the schema did not predict.
 *
 * This keeps the behaviour the app already shipped. Turning real validation on
 * is a deliberate follow-up that needs testing against live servers, not a
 * side effect of moving to the shared client; the harness default validates,
 * and dropping this option is all it takes.
 */
export const PERMISSIVE_MCP_OUTPUT_VALIDATION = {
	getValidator: () => (input: unknown) => ({
		valid: true as const,
		data: input,
		errorMessage: undefined,
	}),
} as never;

export type MCPToolRuntimeMetadata = {
	source: "mcp";
	mcp: {
		serverName: string;
		originalToolName: string;
		title?: string;
		outputSchema?: Record<string, unknown>;
		icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
		annotations?: Record<string, unknown>;
	};
};

/** The exact key set `normalizeMcpToolResult` emits for a non-text result. */
const RICH_RESULT_KEYS = new Set(["text", "content", "structuredContent", "meta"]);

/**
 * Is this JSON the wrapper `normalizeMcpToolResult` produces, or a tool's own
 * payload that happens to be JSON?
 *
 * Testing for a `content` key alone is not enough to tell them apart, and
 * guessing wrong is destructive: a result like
 * `{"successful": true, "content": "…", "schema": {…}}` was unwrapped down to
 * its `content` value, silently discarding every sibling key — including the
 * argument schemas a model needs to make the next call. The wrapper is
 * recognised by its whole shape instead: only those four keys, and `content`
 * always the array of non-text blocks it was built from.
 */
const isRichMcpEnvelope = (parsed: Record<string, unknown>): boolean => {
	if (
		parsed.structuredContent === undefined &&
		parsed.meta === undefined &&
		parsed.content === undefined
	) {
		return false;
	}
	if (parsed.content !== undefined && !Array.isArray(parsed.content)) {
		return false;
	}
	return Object.keys(parsed).every((key) => RICH_RESULT_KEYS.has(key));
};

/**
 * A result carrying more than text arrives as JSON. Parsing it back lets the UI
 * render the structured payload instead of dumping the wrapper as prose; a
 * result that is just text is passed through untouched.
 */
const parseRichMcpResult = (value: string): ToolExecutionResult | undefined => {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			!isRichMcpEnvelope(parsed as Record<string, unknown>)
		) {
			return undefined;
		}
		const envelope = parsed as Record<string, unknown>;
		return {
			content:
				typeof envelope.text === "string"
					? envelope.text
					: envelope.content === undefined
						? ""
						: JSON.stringify(envelope.content),
			structuredContent: envelope.structuredContent,
			meta:
				typeof envelope.meta === "object" && envelope.meta !== null
					? (envelope.meta as Record<string, unknown>)
					: undefined,
		};
	} catch {
		return undefined;
	}
};

export function adaptMCPTool(
	manager: Pick<McpClientManager, "call">,
	descriptor: McpToolDescriptor,
): BaseTool {
	const metadata: MCPToolRuntimeMetadata = {
		source: "mcp",
		mcp: {
			serverName: descriptor.serverId,
			originalToolName: descriptor.name,
			title: descriptor.title,
			outputSchema: descriptor.outputSchema as
				| Record<string, unknown>
				| undefined,
			icons: descriptor.icons as MCPToolRuntimeMetadata["mcp"]["icons"],
			annotations: descriptor.annotations as
				| Record<string, unknown>
				| undefined,
		},
	};

	return {
		name: descriptor.exposedName,
		title: descriptor.title,
		description: descriptor.description,
		schema: jsonToolSchema(
			(descriptor.inputSchema as Record<string, unknown> | undefined) ?? {
				type: "object",
				properties: {},
			},
		),
		outputSchema: metadata.mcp.outputSchema,
		icons: metadata.mcp.icons,
		annotations: metadata.mcp.annotations,
		metadata,
		execute: async (input: unknown): Promise<ToolResultValue> => {
			const result = await manager.call(
				descriptor.serverId,
				descriptor.name,
				(input ?? {}) as Record<string, unknown>,
			);
			const text = normalizeMcpToolResult(
				descriptor.serverId,
				descriptor.name,
				{
					content: result.content as readonly Record<string, unknown>[],
					isError: result.isError,
					structuredContent: result.structuredContent,
					meta: result.meta,
				},
			);
			return parseRichMcpResult(text) ?? text;
		},
	};
}
