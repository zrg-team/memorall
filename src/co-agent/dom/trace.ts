import type {
	CoAgentContentCommandRequest,
	CoAgentContentCommandResponse,
	CoAgentElementInfo,
	CoAgentTraceStep,
	CoAgentViewport,
} from "@/co-agent/protocol";

const traceSteps: CoAgentTraceStep[] = [];

export const getCoAgentTrace = (): CoAgentTraceStep[] => [...traceSteps];

export const formatCoAgentTracePrompt = (): string =>
	[
		"Co-agent captured browser interaction flow.",
		"",
		"Use this trace as source material for a future replayable agent prompt.",
		"",
		JSON.stringify(getCoAgentTrace(), null, 2),
	].join("\n");

const summarizeResponse = (
	response: CoAgentContentCommandResponse,
	element?: CoAgentElementInfo,
): string => {
	if (!response.success) return response.error;
	if (response.note) return response.note;
	if (element)
		return `${element.tagName}: ${element.text || element.value || ""}`;
	if (response.elements) return `${response.elements.length} element(s)`;
	if (response.snapshot)
		return (response.snapshot.visibleText ?? "").slice(0, 240);
	return "Done";
};

const argsFromRequest = (
	request: CoAgentContentCommandRequest,
): Record<string, unknown> => {
	const { source: _source, ...args } = request;
	return args;
};

export const recordTraceStep = ({
	request,
	before,
	after,
	response,
	element,
	blocked,
}: {
	request: CoAgentContentCommandRequest;
	before: CoAgentViewport;
	after: CoAgentViewport;
	response: CoAgentContentCommandResponse;
	element?: CoAgentElementInfo;
	blocked?: boolean;
}): void => {
	traceSteps.push({
		id:
			typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		timestamp: new Date().toISOString(),
		url: window.location.href,
		title: document.title || "",
		command: request.type,
		args: argsFromRequest(request),
		before,
		after,
		resultSummary: summarizeResponse(response, element),
		selector:
			"selector" in request && typeof request.selector === "string"
				? request.selector
				: undefined,
		stableSelector: element?.stableSelector,
		rect: element?.rect,
		blocked,
	});
};
