import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/co-agent/protocol";
import type {
	CoAgentContentCommandRequest,
	CoAgentContentCommandResponse,
	CoAgentElementInfo,
} from "@/co-agent/protocol";
import { buildSnapshot } from "./dom-utils";

export const createSuccessResponse = (
	request: CoAgentContentCommandRequest,
	payload: Omit<
		Extract<CoAgentContentCommandResponse, { success: true }>,
		"source" | "type" | "success"
	>,
): CoAgentContentCommandResponse => ({
	source: CO_AGENT_CONTENT_COMMAND_SOURCE,
	type: `${request.type}-result` as CoAgentContentCommandResponse["type"],
	success: true,
	...payload,
});

export const createErrorResponse = (
	request: CoAgentContentCommandRequest,
	error: unknown,
): CoAgentContentCommandResponse => ({
	source: CO_AGENT_CONTENT_COMMAND_SOURCE,
	type: `${request.type}-result` as CoAgentContentCommandResponse["type"],
	success: false,
	error: error instanceof Error ? error.message : String(error),
});

export const createBlockedResponse = (
	request: CoAgentContentCommandRequest,
	error: unknown,
	element?: CoAgentElementInfo,
): CoAgentContentCommandResponse =>
	createSuccessResponse(request, {
		element,
		blocked: true,
		requiresUserAction: true,
		note: error instanceof Error ? error.message : String(error),
		snapshot: buildSnapshot({ maxDomElements: 0 }),
	});
