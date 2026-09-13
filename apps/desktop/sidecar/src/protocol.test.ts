import { describe, expect, it } from "vitest";
import { parseSidecarRequest } from "./protocol";

describe("desktop sidecar protocol", () => {
	it("accepts a versioned allowlisted request", () => {
		expect(
			parseSidecarRequest({
				protocolVersion: 3,
				id: "request-1",
				method: "browser.command",
				params: { command: "snapshot" },
			}),
		).toMatchObject({ id: "request-1", method: "browser.command" });
	});

	it("allowlists the local MCP server methods", () => {
		for (const method of [
			"mcp.stdio.ensure",
			"mcp.stdio.list-tools",
			"mcp.stdio.call",
			"mcp.stdio.cancel",
			"mcp.stdio.stop",
			"mcp.stdio.status",
			"mcp.stdio.probe",
		]) {
			expect(
				parseSidecarRequest({
					protocolVersion: 3,
					id: "x",
					method,
					params: {},
				}),
			).toMatchObject({ method });
		}
		expect(() =>
			parseSidecarRequest({
				protocolVersion: 3,
				id: "x",
				method: "mcp.stdio.connect",
				params: {},
			}),
		).toThrow("not allowed");
	});

	it("rejects version mismatches and non-allowlisted methods", () => {
		expect(() =>
			parseSidecarRequest({ protocolVersion: 1, id: "x", method: "health" }),
		).toThrow("Unsupported");
		expect(() =>
			parseSidecarRequest({
				protocolVersion: 3,
				id: "x",
				method: "shell.exec",
			}),
		).toThrow("not allowed");
		expect(() =>
			parseSidecarRequest({ protocolVersion: 3, id: "x", method: "health" }),
		).toThrow("params");
	});
});
