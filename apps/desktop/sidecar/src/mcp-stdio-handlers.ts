import type { McpStdioHost } from "./mcp-stdio-host";
import { McpStdioError, parseStdioSpec } from "./mcp-stdio-spec";

export const MCP_STDIO_METHODS = [
	"mcp.stdio.ensure",
	"mcp.stdio.list-tools",
	"mcp.stdio.call",
	"mcp.stdio.cancel",
	"mcp.stdio.stop",
	"mcp.stdio.status",
	"mcp.stdio.probe",
] as const;

export type McpStdioMethod = (typeof MCP_STDIO_METHODS)[number];

export const isMcpStdioMethod = (method: string): method is McpStdioMethod =>
	(MCP_STDIO_METHODS as readonly string[]).includes(method);

/**
 * Calls that can be cancelled by id. The frontend cannot cancel a Tauri invoke
 * and never learns the protocol request id, so it names the call itself.
 */
const cancellableCalls = new Map<string, AbortController>();

const invalid = (message: string) =>
	new McpStdioError("MCP_STDIO_INVALID_REQUEST", message);

const record = (value: unknown, method: string): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalid(`${method} params must be an object.`);
	}
	const params = value as Record<string, unknown>;
	return params;
};

const onlyKeys = (
	params: Record<string, unknown>,
	allowed: string[],
	method: string,
): void => {
	const unexpected = Object.keys(params).filter(
		(key) => !allowed.includes(key),
	);
	if (unexpected.length > 0) {
		throw invalid(
			`${method} received unexpected params: ${unexpected.join(", ")}.`,
		);
	}
};

const optionalTimeout = (
	value: unknown,
	label: string,
	method: string,
): number | undefined => {
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > 600_000
	) {
		throw invalid(
			`${method} ${label} must be an integer between 1 and 600000.`,
		);
	}
	return value;
};

const nonEmptyString = (
	value: unknown,
	label: string,
	method: string,
): string => {
	if (typeof value !== "string" || !value.trim()) {
		throw invalid(`${method} ${label} must be a non-empty string.`);
	}
	return value;
};

const stringList = (
	value: unknown,
	label: string,
	method: string,
): string[] => {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw invalid(`${method} ${label} must be an array of strings.`);
	}
	return value as string[];
};

export async function handleMcpStdioRequest(
	host: McpStdioHost,
	method: McpStdioMethod,
	rawParams: unknown,
	signal: AbortSignal,
): Promise<unknown> {
	try {
		return await dispatch(host, method, rawParams, signal);
	} catch (error) {
		// A failure inside a running server (a timeout, a protocol error) is not
		// a malformed request; give the caller a code it can tell apart.
		if (error instanceof McpStdioError) throw error;
		throw new McpStdioError(
			signal.aborted ? "MCP_STDIO_CANCELLED" : "MCP_STDIO_REQUEST_FAILED",
			error instanceof Error ? error.message : String(error),
		);
	}
}

async function dispatch(
	host: McpStdioHost,
	method: McpStdioMethod,
	rawParams: unknown,
	signal: AbortSignal,
): Promise<unknown> {
	const params = record(rawParams, method);
	switch (method) {
		case "mcp.stdio.ensure": {
			onlyKeys(params, ["spec", "force", "startTimeoutMs"], method);
			if (params.force !== undefined && typeof params.force !== "boolean") {
				throw invalid(`${method} force must be a boolean.`);
			}
			return host.ensure(parseStdioSpec(params.spec), {
				force: params.force === true,
				startTimeoutMs: optionalTimeout(
					params.startTimeoutMs,
					"startTimeoutMs",
					method,
				),
			});
		}
		case "mcp.stdio.list-tools": {
			onlyKeys(params, ["spec", "startTimeoutMs"], method);
			return {
				tools: await host.listTools(parseStdioSpec(params.spec), {
					startTimeoutMs: optionalTimeout(
						params.startTimeoutMs,
						"startTimeoutMs",
						method,
					),
				}),
			};
		}
		case "mcp.stdio.call": {
			onlyKeys(
				params,
				["spec", "tool", "input", "timeoutMs", "callId"],
				method,
			);
			const input = params.input ?? {};
			if (typeof input !== "object" || input === null || Array.isArray(input)) {
				throw invalid(`${method} input must be an object.`);
			}
			const spec = parseStdioSpec(params.spec);
			const tool = nonEmptyString(params.tool, "tool", method);
			const timeoutMs = optionalTimeout(params.timeoutMs, "timeoutMs", method);
			if (params.callId === undefined) {
				return host.call(spec, tool, input as Record<string, unknown>, {
					signal,
					timeoutMs,
				});
			}
			const callId = nonEmptyString(params.callId, "callId", method);
			const controller = new AbortController();
			cancellableCalls.set(callId, controller);
			try {
				return await host.call(spec, tool, input as Record<string, unknown>, {
					signal: AbortSignal.any([signal, controller.signal]),
					timeoutMs,
				});
			} catch (error) {
				if (controller.signal.aborted) {
					throw new McpStdioError(
						"MCP_STDIO_CANCELLED",
						"The call was cancelled.",
					);
				}
				throw error;
			} finally {
				cancellableCalls.delete(callId);
			}
		}
		case "mcp.stdio.cancel": {
			onlyKeys(params, ["callId"], method);
			const controller = cancellableCalls.get(
				nonEmptyString(params.callId, "callId", method),
			);
			controller?.abort();
			return { cancelled: Boolean(controller) };
		}
		case "mcp.stdio.stop": {
			onlyKeys(params, ["id"], method);
			return {
				status: await host.stop(nonEmptyString(params.id, "id", method)),
			};
		}
		case "mcp.stdio.status": {
			onlyKeys(params, ["ids"], method);
			return {
				servers: host.status(
					params.ids === undefined
						? undefined
						: stringList(params.ids, "ids", method),
				),
			};
		}
		case "mcp.stdio.probe": {
			onlyKeys(params, ["commands"], method);
			const commands = stringList(params.commands, "commands", method);
			if (commands.length === 0 || commands.length > 16) {
				throw invalid(`${method} commands must list 1 to 16 commands.`);
			}
			return host.probe(commands);
		}
	}
}
