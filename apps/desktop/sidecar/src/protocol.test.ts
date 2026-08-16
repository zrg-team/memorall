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
