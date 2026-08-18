import { nanoid } from "nanoid";
import type {
	ToolExecutionContext,
	ToolExecutionMeta,
	ToolExecutionResult,
} from "../../interfaces/engine/tool.js";
import type {
	IAgentSandboxService,
	SandboxCallContext,
} from "../../interfaces/services/agent-sandbox.js";
import { SandboxError } from "../../interfaces/services/agent-sandbox.js";
import { getRuntimeGraphId } from "../../runtime/runtime-context.js";

export const SANDBOX_TOOL_OUTPUT_SCHEMA = {
	type: "object",
	required: ["ok", "operation"],
	properties: {
		ok: { type: "boolean" },
		operation: { type: "string" },
		result: {},
		error: {
			type: "object",
			properties: {
				code: { type: "string" },
				message: { type: "string" },
				retryable: { type: "boolean" },
			},
		},
	},
} as const;

const serialize = (value: unknown): string => JSON.stringify(value, null, 2);

export const createSandboxCallContext = (
	toolName: string,
	context?: ToolExecutionContext,
): SandboxCallContext => ({
	operationId: `${toolName}:${nanoid(12)}`,
	sessionKey: getRuntimeGraphId(context?.runtime),
});

const extractIds = (result: unknown): ToolExecutionMeta => {
	if (typeof result !== "object" || result === null) return {};
	const record = result as Record<string, unknown>;
	return {
		...(typeof record.processId === "string"
			? { processId: record.processId }
			: {}),
		...(typeof record.previewId === "string"
			? { previewId: record.previewId }
			: {}),
		...(typeof record.snapshotId === "string"
			? { snapshotId: record.snapshotId }
			: {}),
		...(typeof record.nextCursor === "string"
			? { nextCursor: record.nextCursor }
			: {}),
		...(typeof record.durationMs === "number"
			? { durationMs: record.durationMs }
			: {}),
		...(typeof record.truncated === "boolean"
			? { truncated: record.truncated }
			: {}),
	};
};

export const sandboxToolResult = (
	operation: string,
	result: unknown,
	context: SandboxCallContext,
	structuredOverride?: Record<string, unknown>,
): ToolExecutionResult => {
	const structured =
		structuredOverride ?? ({ ok: true, operation, result } as const);
	return {
		content: serialize(structured),
		structuredContent: structured,
		meta: {
			operationId: context.operationId,
			...extractIds(result),
		},
	};
};

export const sandboxToolError = (
	operation: string,
	error: unknown,
	context: SandboxCallContext,
): ToolExecutionResult => {
	const normalized =
		error instanceof SandboxError
			? error
			: new SandboxError(
					"provider_error",
					error instanceof Error ? error.message : String(error),
					{ cause: error },
				);
	const structured = {
		ok: false,
		operation,
		error: {
			code: normalized.code,
			message: normalized.message,
			retryable: normalized.retryable,
		},
	};
	return {
		content: serialize(structured),
		structuredContent: structured,
		isError: true,
		meta: { operationId: context.operationId },
	};
};

export const executeSandboxOperation = async (
	service: IAgentSandboxService | undefined,
	toolName: string,
	operation: string,
	context: ToolExecutionContext | undefined,
	execute: (
		service: IAgentSandboxService,
		callContext: SandboxCallContext,
	) => Promise<unknown>,
	structuredOverride?: (result: unknown) => Record<string, unknown>,
): Promise<ToolExecutionResult> => {
	const callContext = createSandboxCallContext(toolName, context);
	if (!service) {
		return sandboxToolError(
			operation,
			new SandboxError(
				"capability_unavailable",
				"Sandbox runtime service is unavailable",
			),
			callContext,
		);
	}
	try {
		const result = await execute(service, callContext);
		return sandboxToolResult(
			operation,
			result,
			callContext,
			structuredOverride?.(result),
		);
	} catch (error) {
		return sandboxToolError(operation, error, callContext);
	}
};

export const validateOperationFields = (
	data: Record<string, unknown>,
	ctx: {
		addIssue: (issue: {
			code: "custom";
			path: string[];
			message: string;
		}) => void;
	},
	allowed: readonly string[],
	required: readonly string[] = [],
): void => {
	for (const field of required) {
		if (data[field] === undefined || data[field] === "") {
			ctx.addIssue({
				code: "custom",
				path: [field],
				message: `${field} is required for ${String(data.operation)}`,
			});
		}
	}
	for (const [field, value] of Object.entries(data)) {
		if (
			field !== "operation" &&
			value !== undefined &&
			!allowed.includes(field)
		) {
			ctx.addIssue({
				code: "custom",
				path: [field],
				message: `${field} is not valid for ${String(data.operation)}`,
			});
		}
	}
};
