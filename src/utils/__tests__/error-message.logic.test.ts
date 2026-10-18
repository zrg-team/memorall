import { describe, expect, it } from "vitest";
import { errorMessage, rootErrorMessage } from "../error-message";

describe("errorMessage", () => {
	it("reads a native error's message after serialization", () => {
		expect(
			errorMessage({
				code: "VM_START_FAILED",
				message: "Enable virtualization",
			}),
		).toBe("Enable virtualization");
	});
	it("keeps structured details when there is no message", () => {
		expect(errorMessage({ code: "DISCONNECTED" })).toBe(
			'{"code":"DISCONNECTED"}',
		);
	});
	it("handles an object that cannot be serialized", () => {
		const error: Record<string, unknown> = {};
		error.self = error;
		expect(errorMessage(error)).toBe("Unknown error");
	});
});

describe("rootErrorMessage", () => {
	it("reads the error a failed query wraps, not its SQL", () => {
		const error = new Error('Failed query: select "messages"."uuid" ...', {
			cause: new Error('RPC timeout after 30000ms for op "query"'),
		});
		expect(rootErrorMessage(error)).toBe(
			'RPC timeout after 30000ms for op "query"',
		);
	});

	it("follows a chain of causes to the first one", () => {
		const error = new Error("outer", {
			cause: new Error("middle", { cause: new Error("out of memory") }),
		});
		expect(rootErrorMessage(error)).toBe("out of memory");
	});

	it("keeps the closest message when a cause has none", () => {
		const error = new Error("Failed query", { cause: new Error("") });
		expect(rootErrorMessage(error)).toBe("Failed query");
	});

	it("reads a cause that is not an Error", () => {
		expect(
			rootErrorMessage(new Error("outer", { cause: "disconnected" })),
		).toBe("disconnected");
	});

	it("stops on a cause that points back at itself", () => {
		const error = new Error("loop");
		error.cause = error;
		expect(rootErrorMessage(error)).toBe("loop");
	});

	it("reads values that are not errors", () => {
		expect(rootErrorMessage("plain")).toBe("plain");
	});
});
