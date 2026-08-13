import { describe, expect, it } from "vitest";
import { parseSidecarRequest } from "./protocol";

describe("desktop sidecar protocol", () => {
	it("accepts a versioned allowlisted request", () => {
		expect(
			parseSidecarRequest({
				protocolVersion: 1,
				id: "request-1",
				method: "health",
				params: {},
			}),
		).toMatchObject({ id: "request-1", method: "health" });
	});

	it("rejects version mismatches and non-allowlisted methods", () => {
		expect(() =>
			parseSidecarRequest({ protocolVersion: 2, id: "x", method: "health" }),
		).toThrow("Unsupported");
		expect(() =>
			parseSidecarRequest({ protocolVersion: 1, id: "x", method: "shell.exec" }),
		).toThrow("not allowed");
	});
});
