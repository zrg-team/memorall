import {
	BrowserAutomationError,
	isRecord,
	requiredString,
} from "./browser-runtime-types";

export const CO_AGENT_BROWSER_COMMAND_SOURCE =
	"memorall:co-agent-browser-command" as const;
export const CO_AGENT_CONTENT_COMMAND_SOURCE =
	"memorall:co-agent-content-command" as const;

const CONTENT_COMMANDS = [
	"co-agent:observe",
	"co-agent:query",
	"co-agent:move",
	"co-agent:scroll",
	"co-agent:click",
	"co-agent:input",
	"co-agent:get-trace",
] as const;

export type CoAgentSidecarCommand =
	| "activate"
	| "get-active"
	| "content-command"
	| "detach";

export interface CoAgentCommand {
	source: typeof CO_AGENT_BROWSER_COMMAND_SOURCE;
	command: CoAgentSidecarCommand;
	url?: string;
	tabId?: number;
	timeoutMs?: number;
	request?: Record<string, unknown>;
}

/**
 * Parse a co-agent request.
 *
 * Deliberately separate from `parseBrowserCommand`: that one guards the web-tool
 * grammar and must keep rejecting anything that is not a web-browser command.
 * Loosening it to admit a second vocabulary would weaken the check that already
 * exists rather than add one.
 */
export const parseCoAgentCommand = (value: unknown): CoAgentCommand => {
	if (!isRecord(value) || value.source !== CO_AGENT_BROWSER_COMMAND_SOURCE) {
		throw new BrowserAutomationError(
			"INVALID_CO_AGENT_REQUEST",
			"Co-agent request has an invalid source.",
		);
	}
	const command = requiredString(value, "command");
	if (!["activate", "get-active", "content-command", "detach"].includes(command)) {
		throw new BrowserAutomationError(
			"INVALID_CO_AGENT_REQUEST",
			`Unsupported co-agent command: ${command}`,
		);
	}

	const tabId = value.tabId;
	if (
		tabId !== undefined &&
		(typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId < 1)
	) {
		throw new BrowserAutomationError(
			"INVALID_CO_AGENT_REQUEST",
			"Co-agent tabId must be a positive integer.",
		);
	}

	const timeoutMs = value.timeoutMs;
	if (
		timeoutMs !== undefined &&
		(typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
	) {
		throw new BrowserAutomationError(
			"INVALID_CO_AGENT_REQUEST",
			"Co-agent timeoutMs must be a positive number.",
		);
	}

	if (command === "activate" && value.url !== undefined) {
		const url = requiredString(value, "url");
		if (!/^https?:\/\//i.test(url)) {
			throw new BrowserAutomationError(
				"INVALID_CO_AGENT_REQUEST",
				"The co-agent can only open http(s) pages.",
			);
		}
	}

	if (command === "content-command") {
		const request = value.request;
		if (!isRecord(request)) {
			throw new BrowserAutomationError(
				"INVALID_CO_AGENT_REQUEST",
				"Co-agent content command is missing its request.",
			);
		}
		if (request.source !== CO_AGENT_CONTENT_COMMAND_SOURCE) {
			throw new BrowserAutomationError(
				"INVALID_CO_AGENT_REQUEST",
				"Co-agent content command has an invalid source.",
			);
		}
		const type = requiredString(request, "type");
		if (!CONTENT_COMMANDS.includes(type as (typeof CONTENT_COMMANDS)[number])) {
			throw new BrowserAutomationError(
				"INVALID_CO_AGENT_REQUEST",
				`Unsupported co-agent content command: ${type}`,
			);
		}
	}

	return value as unknown as CoAgentCommand;
};

export const isCoAgentRequest = (value: unknown): boolean =>
	isRecord(value) && value.source === CO_AGENT_BROWSER_COMMAND_SOURCE;
