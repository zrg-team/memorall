import { describe, expect, it } from "vitest";
import {
	COAGENT_SESSION_END,
	COAGENT_SESSION_START,
	isCoAgentSessionMarker,
	CO_AGENT_SESSION_MAX_IDLE_MS,
	findOpenCoAgentSession,
	isCoAgentSessionStale,
	getCoAgentSessionUrl,
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

const startedOn = (url?: string) => ({
	type: COAGENT_SESSION_START,
	metadata: url ? { source: "co-agent", url } : { source: "co-agent" },
});

describe("tying a session to the page it was opened on", () => {
	const PAGE = "https://example.com/listing/1";

	it("finds the start marker of an open session", () => {
		const start = startedOn(PAGE);
		expect(findOpenCoAgentSession([msg(), start, msg()])).toBe(start);
	});

	it("finds nothing once the session was closed", () => {
		expect(
			findOpenCoAgentSession([startedOn(PAGE), msg(COAGENT_SESSION_END)]),
		).toBeNull();
	});

	it("reads back the page a session was opened for", () => {
		expect(getCoAgentSessionUrl(startedOn(PAGE))).toBe(PAGE);
		expect(getCoAgentSessionUrl(startedOn())).toBeNull();
	});
});

describe("letting an abandoned session go cold", () => {
	const NOW = new Date("2026-01-01T12:00:00Z").getTime();
	const at = (msAgo: number) => ({ createdAt: new Date(NOW - msAgo) });

	it("keeps a session that was in use moments ago", () => {
		expect(isCoAgentSessionStale([at(60_000)], NOW)).toBe(false);
	});

	it("keeps a session alive across a navigation", () => {
		// A session deliberately spans pages: following a trail from one page to
		// the next is a single piece of work, not two sessions.
		expect(isCoAgentSessionStale([at(600_000), at(30_000)], NOW)).toBe(false);
	});

	it("gives up on a session abandoned long ago", () => {
		// The tab was closed without an end marker; the next question should not
		// be filed under yesterday's session.
		expect(
			isCoAgentSessionStale([at(CO_AGENT_SESSION_MAX_IDLE_MS + 1)], NOW),
		).toBe(true);
	});

	it("judges by the newest message, not the oldest", () => {
		expect(
			isCoAgentSessionStale(
				[at(CO_AGENT_SESSION_MAX_IDLE_MS * 4), at(1_000)],
				NOW,
			),
		).toBe(false);
	});

	it("reads a stored date string as well as a Date", () => {
		expect(
			isCoAgentSessionStale(
				[{ createdAt: new Date(NOW - 1_000).toISOString() }],
				NOW,
			),
		).toBe(false);
	});

	it("leaves a session open when nothing can be dated", () => {
		expect(isCoAgentSessionStale([{ createdAt: null }], NOW)).toBe(false);
		expect(isCoAgentSessionStale([], NOW)).toBe(false);
	});
});
