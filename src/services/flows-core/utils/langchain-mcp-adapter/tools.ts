import { DynamicStructuredTool } from "@langchain/core/tools";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
	LoadMcpToolsOptions,
	StreamableHTTPConnection,
} from "@/services/flows-core/utils/langchain-mcp-adapter/types";

type JsonSchema = Record<string, unknown>;

type MCPToolDefinition = {
	name: string;
	title?: string;
	description?: string;
	inputSchema: JsonSchema;
	outputSchema?: JsonSchema;
	icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
	annotations?: Record<string, unknown>;
};

type MCPToolMetadata = {
	source: "mcp";
	mcp: {
		serverName: string;
		originalToolName: string;
		title?: string;
		outputSchema?: JsonSchema;
		icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
		annotations?: Record<string, unknown>;
	};
};

type MCPCallToolResult = {
	content?: Array<Record<string, unknown>>;
	isError?: boolean;
	structuredContent?: unknown;
	_meta?: unknown;
};

type MCPListToolsResult = {
	tools?: MCPToolDefinition[];
	nextCursor?: string;
};

type FallbackConnection = Pick<StreamableHTTPConnection, "url" | "headers">;

const dereferenceJsonSchema = (schema: JsonSchema): JsonSchema => {
	const definitions = (schema.$defs ?? schema.definitions ?? {}) as Record<
		string,
		JsonSchema
	>;

	const resolveRefs = (
		value: unknown,
		visitedRefs = new Set<string>(),
	): unknown => {
		if (typeof value !== "object" || value === null) {
			return value;
		}

		if (
			"$ref" in value &&
			typeof value.$ref === "string" &&
			(value.$ref.startsWith("#/$defs/") ||
				value.$ref.startsWith("#/definitions/"))
		) {
			const refPath = value.$ref;
			const definitionName = refPath.split("/").at(-1);
			if (!definitionName) {
				return value;
			}

			const definition = definitions[definitionName];
			if (!definition) {
				return value;
			}

			if (visitedRefs.has(refPath)) {
				return { type: "object" };
			}

			const nextVisitedRefs = new Set(visitedRefs);
			nextVisitedRefs.add(refPath);

			const { $ref: _ref, ...rest } = value as JsonSchema;
			return {
				...(resolveRefs(definition, nextVisitedRefs) as JsonSchema),
				...rest,
			};
		}

		if (Array.isArray(value)) {
			return value.map((item) => resolveRefs(item, visitedRefs));
		}

		const result: JsonSchema = {};
		for (const [key, entry] of Object.entries(value)) {
			if (key === "$defs" || key === "definitions") {
				continue;
			}
			result[key] = resolveRefs(entry, visitedRefs);
		}
		return result;
	};

	return resolveRefs(schema) as JsonSchema;
};

const deepMergeSchemas = (
	target: JsonSchema,
	source: JsonSchema,
): JsonSchema => {
	const result: JsonSchema = { ...target };

	for (const [key, sourceValue] of Object.entries(source)) {
		const targetValue = result[key];

		if (key === "required" && Array.isArray(targetValue)) {
			result[key] = [
				...new Set([...targetValue, ...(sourceValue as unknown[])]),
			];
			continue;
		}

		if (
			key === "properties" &&
			isPlainObject(targetValue) &&
			isPlainObject(sourceValue)
		) {
			const mergedProperties: JsonSchema = { ...targetValue };
			for (const [propertyKey, propertyValue] of Object.entries(sourceValue)) {
				mergedProperties[propertyKey] =
					isPlainObject(mergedProperties[propertyKey]) &&
					isPlainObject(propertyValue)
						? deepMergeSchemas(
								mergedProperties[propertyKey] as JsonSchema,
								propertyValue,
							)
						: propertyValue;
			}
			result[key] = mergedProperties;
			continue;
		}

		if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
			result[key] = [...targetValue, ...sourceValue];
			continue;
		}

		if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
			result[key] = deepMergeSchemas(
				targetValue as JsonSchema,
				sourceValue as JsonSchema,
			);
			continue;
		}

		result[key] = sourceValue;
	}

	return result;
};

const extractPropertiesFromConditional = (schema: JsonSchema): JsonSchema => {
	let result: JsonSchema = {};

	for (const branch of [schema.then, schema.else]) {
		if (!isPlainObject(branch)) {
			continue;
		}

		if (isPlainObject(branch.properties)) {
			result = deepMergeSchemas(result, { properties: branch.properties });
		}

		if (Array.isArray(branch.required)) {
			result.required = [
				...new Set([
					...((result.required as unknown[] | undefined) ?? []),
					...branch.required,
				]),
			];
		}
	}

	return result;
};

const simplifyJsonSchemaForLLM = (schema: JsonSchema): JsonSchema => {
	const {
		allOf,
		anyOf,
		oneOf,
		not: _not,
		if: conditionalIf,
		then: conditionalThen,
		else: conditionalElse,
		$schema: _schema,
		unevaluatedProperties: _unevaluatedProperties,
		...baseSchema
	} = schema;

	let result: JsonSchema = { ...baseSchema };

	if (conditionalIf || conditionalThen || conditionalElse) {
		result = deepMergeSchemas(
			result,
			extractPropertiesFromConditional({
				if: conditionalIf,
				then: conditionalThen,
				else: conditionalElse,
			}),
		);
	}

	if (Array.isArray(allOf)) {
		for (const entry of allOf) {
			if (isPlainObject(entry)) {
				if (entry.if || entry.then || entry.else) {
					result = deepMergeSchemas(
						result,
						extractPropertiesFromConditional(entry),
					);
				}
				result = deepMergeSchemas(result, simplifyJsonSchemaForLLM(entry));
			}
		}
	}

	const unionSchemas = Array.isArray(anyOf)
		? anyOf
		: Array.isArray(oneOf)
			? oneOf
			: undefined;

	if (unionSchemas?.length) {
		const objectSchemas = unionSchemas.filter(
			(entry): entry is JsonSchema =>
				isPlainObject(entry) &&
				((entry.type as string | undefined) === "object" ||
					isPlainObject(entry.properties)),
		);

		if (objectSchemas.length > 0) {
			const mergedProperties: JsonSchema = {};
			const requiredSets: Array<Set<string>> = [];

			for (const objectSchema of objectSchemas) {
				const simplified = simplifyJsonSchemaForLLM(objectSchema);
				if (isPlainObject(simplified.properties)) {
					Object.assign(mergedProperties, simplified.properties);
				}
				if (Array.isArray(simplified.required)) {
					requiredSets.push(new Set(simplified.required as string[]));
				}
				if (simplified.type && !result.type) {
					result.type = simplified.type;
				}
			}

			if (Object.keys(mergedProperties).length > 0) {
				result.properties = {
					...(isPlainObject(result.properties) ? result.properties : {}),
					...mergedProperties,
				};
			}

			if (requiredSets.length > 0) {
				const commonRequired = requiredSets.reduce((current, set) => {
					return new Set([...current].filter((key) => set.has(key)));
				});
				if (commonRequired.size > 0) {
					result.required = [
						...new Set([
							...((result.required as string[] | undefined) ?? []),
							...commonRequired,
						]),
					];
				}
			}
		}
	}

	if (isPlainObject(result.properties) && !result.type) {
		result.type = "object";
		result.properties = Object.fromEntries(
			Object.entries(result.properties).map(([key, value]) => [
				key,
				isPlainObject(value)
					? simplifyJsonSchemaForLLM(value as JsonSchema)
					: value,
			]),
		);
	}

	if (Array.isArray(result.items)) {
		result.items = result.items.map((item) =>
			isPlainObject(item) ? simplifyJsonSchemaForLLM(item as JsonSchema) : item,
		);
	} else if (isPlainObject(result.items)) {
		result.items = simplifyJsonSchemaForLLM(result.items as JsonSchema);
	}

	if (isPlainObject(result.additionalProperties)) {
		result.additionalProperties = simplifyJsonSchemaForLLM(
			result.additionalProperties as JsonSchema,
		);
	}

	return result;
};

const isPlainObject = (value: unknown): value is JsonSchema =>
	typeof value === "object" && value !== null && !Array.isArray(value);

class ToolException extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolException";
	}
}

const extractTextFromContent = (
	content: Record<string, unknown>,
): string | null => {
	return content.type === "text" && typeof content.text === "string"
		? content.text
		: null;
};

const normalizeToolResult = (
	serverName: string,
	toolName: string,
	result: MCPCallToolResult,
): string => {
	if (!result || !Array.isArray(result.content)) {
		throw new ToolException(
			`MCP tool "${toolName}" on server "${serverName}" returned an invalid result.`,
		);
	}

	const textParts = result.content
		.map(extractTextFromContent)
		.filter((value): value is string => Boolean(value));

	if (result.isError) {
		throw new ToolException(
			textParts.join("\n") ||
				`MCP tool "${toolName}" on server "${serverName}" returned an error.`,
		);
	}

	const nonTextContent = result.content.filter(
		(content) => extractTextFromContent(content) === null,
	);

	if (
		nonTextContent.length === 0 &&
		result.structuredContent === undefined &&
		result._meta === undefined
	) {
		return textParts.join("\n");
	}

	return JSON.stringify({
		...(textParts.length > 0 ? { text: textParts.join("\n") } : {}),
		...(nonTextContent.length > 0 ? { content: nonTextContent } : {}),
		...(result.structuredContent !== undefined
			? { structuredContent: result.structuredContent }
			: {}),
		...(result._meta !== undefined ? { meta: result._meta } : {}),
	});
};

const defaultLoadMcpToolsOptions: Required<LoadMcpToolsOptions> = {
	throwOnLoadError: true,
	prefixToolNameWithServerName: false,
	additionalToolNamePrefix: "",
};

const parseJsonRpcSSEPayload = (payload: string): unknown[] => {
	const messages: unknown[] = [];
	let dataLines: string[] = [];

	const flush = () => {
		if (dataLines.length === 0) {
			return;
		}

		const data = dataLines.join("\n").trim();
		dataLines = [];
		if (!data) {
			return;
		}

		messages.push(JSON.parse(data));
	};

	for (const rawLine of payload.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (line === "") {
			flush();
			continue;
		}

		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart());
		}
	}

	flush();
	return messages;
};

const extractListToolsResult = (
	responseBody: string,
	contentType: string | null,
) => {
	const isSSE = contentType?.includes("text/event-stream");
	const parsedPayload = isSSE
		? parseJsonRpcSSEPayload(responseBody)
		: [JSON.parse(responseBody)];

	for (const message of parsedPayload) {
		if (typeof message !== "object" || message === null) {
			continue;
		}

		if ("error" in message && message.error) {
			throw new ToolException(
				`MCP tools/list fallback failed: ${JSON.stringify(message.error)}`,
			);
		}

		if ("result" in message && isPlainObject(message.result)) {
			return message.result as MCPListToolsResult;
		}
	}

	throw new ToolException("MCP tools/list fallback returned no result.");
};

const listToolsViaHttpFallback = async (
	connection: FallbackConnection,
	cursor?: string,
): Promise<MCPListToolsResult> => {
	const headers = new Headers(connection.headers);
	headers.set("content-type", "application/json");
	headers.set("accept", "application/json, text/event-stream");

	const response = await fetch(connection.url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
			...(cursor ? { params: { cursor } } : { params: {} }),
		}),
	});

	if (!response.ok) {
		throw new ToolException(
			`MCP tools/list fallback HTTP ${response.status}: ${response.statusText}`,
		);
	}

	const responseBody = await response.text();
	return extractListToolsResult(
		responseBody,
		response.headers.get("content-type"),
	);
};

const listTools = async (
	client: Client,
	fallbackConnection?: FallbackConnection,
): Promise<MCPToolDefinition[]> => {
	const request = (
		client as unknown as {
			request: (
				payload: { method: string; params?: Record<string, unknown> },
				resultSchema: unknown,
			) => Promise<MCPListToolsResult>;
		}
	).request;

	const loadViaClient = async () => {
		const tools: MCPToolDefinition[] = [];
		let nextCursor: string | undefined;

		do {
			const response = await request(
				{
					method: "tools/list",
					...(nextCursor ? { params: { cursor: nextCursor } } : {}),
				},
				ListToolsResultSchema,
			);
			tools.push(
				...((response.tools as MCPToolDefinition[] | undefined) ?? []),
			);
			nextCursor = response.nextCursor;
		} while (nextCursor);

		return tools;
	};

	try {
		return await loadViaClient();
	} catch (error) {
		if (!fallbackConnection) {
			throw error;
		}

		const tools: MCPToolDefinition[] = [];
		let nextCursor: string | undefined;

		do {
			const response = await listToolsViaHttpFallback(
				fallbackConnection,
				nextCursor,
			);
			tools.push(
				...((response.tools as MCPToolDefinition[] | undefined) ?? []),
			);
			nextCursor = response.nextCursor;
		} while (nextCursor);

		return tools;
	}
};

export async function loadMcpTools(
	serverName: string,
	client: Client,
	options?: LoadMcpToolsOptions,
	fallbackConnection?: FallbackConnection,
): Promise<DynamicStructuredTool[]> {
	const resolvedOptions = {
		...defaultLoadMcpToolsOptions,
		...(options ?? {}),
	};

	const tools = await listTools(client, fallbackConnection);

	const additionalPrefix = resolvedOptions.additionalToolNamePrefix
		? `${resolvedOptions.additionalToolNamePrefix}__`
		: "";
	const serverPrefix = resolvedOptions.prefixToolNameWithServerName
		? `${serverName}__`
		: "";

	const loadedTools = await Promise.all(
		tools
			.filter((tool) => Boolean(tool.name))
			.map(async (tool) => {
				try {
					const rawSchema = isPlainObject(tool.inputSchema)
						? tool.inputSchema
						: { type: "object", properties: {} };
					const schema = simplifyJsonSchemaForLLM(
						dereferenceJsonSchema(rawSchema),
					);
					const dynamicTool = new DynamicStructuredTool({
						name: `${additionalPrefix}${serverPrefix}${tool.name}`,
						description: tool.description || "",
						schema,
						func: async (args) => {
							const result = (await client.callTool({
								name: tool.name,
								arguments: (args ?? {}) as Record<string, unknown>,
							})) as MCPCallToolResult;

							return normalizeToolResult(serverName, tool.name, result);
						},
					});
					(
						dynamicTool as DynamicStructuredTool & {
							metadata?: MCPToolMetadata;
						}
					).metadata = {
						source: "mcp",
						mcp: {
							serverName,
							originalToolName: tool.name,
							title: tool.title,
							outputSchema: tool.outputSchema,
							icons: tool.icons,
							annotations: tool.annotations,
						},
					};
					return dynamicTool;
				} catch (error) {
					if (resolvedOptions.throwOnLoadError) {
						throw error;
					}
					return null;
				}
			}),
	);

	return loadedTools.filter(Boolean) as DynamicStructuredTool[];
}
