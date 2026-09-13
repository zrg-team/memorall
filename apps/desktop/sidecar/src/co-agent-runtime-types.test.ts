import { describe, expect, it } from "vitest";
import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	CO_AGENT_CONTENT_COMMAND_SOURCE,
	isCoAgentRequest,
	parseCoAgentCommand,
} from "./co-agent-runtime-types";
import { parseBrowserCommand } from "./browser-runtime-types";

const request = (over: Record<string, unknown> = {}) => ({
	source: CO_AGENT_BROWSER_COMMAND_SOURCE,
	command: "content-command",
	request: {
		source: CO_AGENT_CONTENT_COMMAND_SOURCE,
		type: "co-agent:observe",
	},
	...over,
});

describe("parseCoAgentCommand", () => {
	it("accepts a well-formed content command", () => {
		expect(parseCoAgentCommand(request()).command).toBe("content-command");
	});

	it.each([
		"co-agent:observe",
		"co-agent:query",
		"co-agent:move",
		"co-agent:scroll",
		"co-agent:click",
		"co-agent:input",
		"co-agent:get-trace",
	])("accepts %s", (type) => {
		expect(() =>
			parseCoAgentCommand(
				request({
					request: { source: CO_AGENT_CONTENT_COMMAND_SOURCE, type },
				}),
			),
		).not.toThrow();
	});

	it("rejects a foreign source", () => {
		expect(() =>
			parseCoAgentCommand(request({ source: "memorall:web-browser-command" })),
		).toThrow(/invalid source/i);
	});

	it("rejects an unknown command", () => {
		expect(() => parseCoAgentCommand(request({ command: "exfiltrate" }))).toThrow(
			/Unsupported co-agent command/i,
		);
	});

	it("rejects a content command whose inner request is foreign", () => {
		expect(() =>
			parseCoAgentCommand(
				request({
					request: { source: "something-else", type: "co-agent:observe" },
				}),
			),
		).toThrow(/invalid source/i);
	});

	it("rejects an unknown content command type", () => {
		expect(() =>
			parseCoAgentCommand(
				request({
					request: {
						source: CO_AGENT_CONTENT_COMMAND_SOURCE,
						type: "co-agent:exec",
					},
				}),
			),
		).toThrow(/Unsupported co-agent content command/i);
	});

	it("only lets the co-agent open http(s) pages", () => {
		expect(() =>
			parseCoAgentCommand({
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "activate",
				url: "file:///etc/passwd",
			}),
		).toThrow(/http/i);
		expect(() =>
			parseCoAgentCommand({
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "activate",
				url: "https://example.test",
			}),
		).not.toThrow();
	});

	it.each([0, -1, 1.5, "3"])("rejects tabId %p", (tabId) => {
		expect(() => parseCoAgentCommand(request({ tabId }))).toThrow(
			/positive integer/i,
		);
	});

	it("rejects a non-positive timeout", () => {
		expect(() => parseCoAgentCommand(request({ timeoutMs: 0 }))).toThrow(
			/positive number/i,
		);
	});
});

describe("isCoAgentRequest", () => {
	it("recognises only the co-agent envelope", () => {
		expect(isCoAgentRequest(request())).toBe(true);
		expect(isCoAgentRequest({ source: "memorall:web-browser-command" })).toBe(
			false,
		);
		expect(isCoAgentRequest(null)).toBe(false);
	});
});

describe("the web-tool grammar is not loosened", () => {
	it("still rejects a co-agent request", () => {
		// The co-agent got its own parser precisely so this check could stay
		// strict; if it ever accepts one, the two vocabularies have been merged.
		expect(() => parseBrowserCommand(request())).toThrow(/invalid source/i);
	});
});
