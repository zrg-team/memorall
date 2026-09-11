import { describe, expect, it } from "vitest";
import {
	COAGENT_SESSION_END,
	COAGENT_SESSION_START,
	isCoAgentSessionMarker,
	isCoAgentSessionOpen,
	isNonModelMessageType,
	shouldCloseCoAgentSession,
} from "../coagent-session";

const msg = (type?: string) => ({ type: type ?? null });

describe("reading the session state off the transcript", () => {
	it("is closed for a conversation that never used the co-agent", () => {
		expect(isCoAgentSessionOpen([msg(), msg(), msg()])).toBe(false);
	});

	it("is open after a start marker", () => {
		expect(
			isCoAgentSessionOpen([msg(), msg(COAGENT_SESSION_START), msg()]),
		).toBe(true);
	});

	it("is closed again after an end marker", () => {
		expect(
			isCoAgentSessionOpen([
				msg(COAGENT_SESSION_START),
				msg(),
				msg(COAGENT_SESSION_END),
				msg(),
			]),
		).toBe(false);
	});

	it("reads the most recent pair, not the first", () => {
		// A second session opens after an earlier one was closed.
		expect(
			isCoAgentSessionOpen([
				msg(COAGENT_SESSION_START),
				msg(COAGENT_SESSION_END),
				msg(COAGENT_SESSION_START),
			]),
		).toBe(true);
	});

	it("is closed for an empty conversation", () => {
		expect(isCoAgentSessionOpen([])).toBe(false);
	});

	it("closes a session the user walked away from", () => {
		// Leaving the page does not press exit; the next message typed in the
		// extension is what ends it.
		expect(shouldCloseCoAgentSession([msg(COAGENT_SESSION_START)])).toBe(true);
		expect(shouldCloseCoAgentSession([msg(COAGENT_SESSION_END)])).toBe(false);
	});
});

describe("what the model is allowed to see", () => {
	it("keeps both markers away from the model, as it does a divider", () => {
		expect(isNonModelMessageType(COAGENT_SESSION_START)).toBe(true);
		expect(isNonModelMessageType(COAGENT_SESSION_END)).toBe(true);
		expect(isNonModelMessageType("separator")).toBe(true);
	});

	it("leaves real messages alone", () => {
		expect(isNonModelMessageType("text")).toBe(false);
		expect(isNonModelMessageType(undefined)).toBe(false);
		expect(isNonModelMessageType(null)).toBe(false);
	});

	it("tells a session marker from a divider", () => {
		// A divider is a history boundary; these are only a visual cue, so they
		// must not be mistaken for one.
		expect(isCoAgentSessionMarker(COAGENT_SESSION_START)).toBe(true);
		expect(isCoAgentSessionMarker("separator")).toBe(false);
	});
});
