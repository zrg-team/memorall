import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	isCoAgentBrowserCommandResponse,
	type CoAgentContentCommandRequest,
	type CoAgentContentCommandResponse,
} from "flow-integrations/interfaces/co-agent";
import { platform } from "@/platform/current";

const DEFAULT_TIMEOUT_MS = 10_000;

export const optionalTrimmedString = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

export const optionalNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

export const optionalBoolean = (value: unknown): boolean | undefined => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (["true", "1", "yes"].includes(normalized)) return true;
	if (["false", "0", "no"].includes(normalized)) return false;
	return undefined;
};

export const optionalOneOf = <T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | undefined => {
	const text = optionalTrimmedString(value);
	if (!text) return undefined;
	return allowed.includes(text as T) ? (text as T) : undefined;
};

export const normalizeIndex = (value: unknown): number | undefined => {
	const number = optionalNumber(value);
	if (number === undefined) return undefined;
	return Math.max(0, Math.floor(number));
};

export const normalizePositiveInteger = (
	value: unknown,
	fallback?: number,
): number | undefined => {
	const number = optionalNumber(value);
	if (number === undefined) return fallback;
	return Math.max(1, Math.floor(number));
};

export const createDefaultErrorResult = (error: unknown): string =>
	JSON.stringify(
		{
			actionType: "co_agent_error",
			success: false,
			error: error instanceof Error ? error.message : String(error),
		},
		null,
		2,
	);

export const createResult = (payload: Record<string, unknown>): string =>
	JSON.stringify(payload, null, 2);

export const createToolInputErrorResult = (
	actionType: string,
	error: string,
	extra?: Record<string, unknown>,
): string =>
	createResult({
		actionType,
		success: false,
		error,
		...extra,
	});

export const sendCoAgentCommand = async (
	request: CoAgentContentCommandRequest,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CoAgentContentCommandResponse> => {
	const rawResponse = await platform.browserCommands.request<unknown>({
		source: CO_AGENT_BROWSER_COMMAND_SOURCE,
		command: "content-command",
		request,
		timeoutMs,
	});
	if (!isCoAgentBrowserCommandResponse(rawResponse)) {
		throw new Error("Invalid co-agent browser response.");
	}
	if (!rawResponse.success) {
		throw new Error(rawResponse.error);
	}
	if (!rawResponse.contentResponse) {
		throw new Error("Co-agent command did not return content data.");
	}
	return rawResponse.contentResponse;
};
