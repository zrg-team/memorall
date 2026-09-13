import { describe, expect, it } from "vitest";
import { formatCoAgentError } from "../co-agent-activation";

/**
 * A failed co-agent activation used to be invisible from the chat input: the
 * store held the reason and nothing on that path displayed it, so the button
 * appeared to ignore the click. It is shown now, which means the wording has to
 * be something a person can read.
 */
describe("formatCoAgentError", () => {
	it("drops the machine code the desktop sidecar prefixes", () => {
		expect(
			formatCoAgentError(
				"BROWSER_LAUNCH_FAILED: The bundled browser could not start.",
			),
		).toBe("The bundled browser could not start.");
	});

	it("leaves an ordinary sentence alone", () => {
		expect(formatCoAgentError("The co-agent did not answer.")).toBe(
			"The co-agent did not answer.",
		);
	});

	it("does not strip a sentence that merely starts with a capital", () => {
		// Only an all-caps code followed by a colon is a prefix.
		expect(formatCoAgentError("Open a page first: then try again")).toBe(
			"Open a page first: then try again",
		);
	});

	it("keeps the code rather than showing nothing", () => {
		expect(formatCoAgentError("SIDECAR_UNAVAILABLE:")).toBe(
			"SIDECAR_UNAVAILABLE:",
		);
	});

	it("is null when there is no error", () => {
		expect(formatCoAgentError(null)).toBeNull();
		expect(formatCoAgentError("")).toBeNull();
	});
});
