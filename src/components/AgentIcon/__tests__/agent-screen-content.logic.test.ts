import { describe, expect, it } from "vitest";
import { toAgentScreenContent } from "../agent-screen-content";

describe("toAgentScreenContent", () => {
	it("shows a configured emoji, sized for the panel", () => {
		expect(
			toAgentScreenContent({ kind: "emoji", value: "📊" }, "Economics"),
		).toEqual({ kind: "emoji", value: "📊", color: undefined, scale: 0.72 });
	});

	it("keeps a text screen's own colour and its tighter scale", () => {
		expect(
			toAgentScreenContent({ kind: "text", value: "EC", color: "#f80" }),
		).toEqual({ kind: "text", value: "EC", color: "#f80", scale: 0.52 });
	});

	it("derives an initial when nothing is configured", () => {
		// The icon draws the same robot for every agent, so without this two
		// unconfigured agents would be indistinguishable in the composer.
		expect(toAgentScreenContent(null, "Research Assistant")).toEqual({
			kind: "text",
			value: "R",
			scale: 0.52,
		});
	});

	it("keeps unconfigured agents apart by name", () => {
		const a = toAgentScreenContent(undefined, "My Economic Report");
		const b = toAgentScreenContent(undefined, "Research Assistant");
		expect(a).not.toEqual(b);
	});

	it("leaves the screen blank when no name is offered", () => {
		// The agent form passes no fallback on purpose: there the empty screen is
		// the value being edited, not a gap to paper over.
		expect(toAgentScreenContent(null)).toBeUndefined();
		expect(toAgentScreenContent(null, "   ")).toBeUndefined();
	});

	it("prefers a configured screen over the name", () => {
		// AgentScreenContent is a union that also allows a bare string, so narrow
		// before reading the field rather than asserting through it.
		expect(
			toAgentScreenContent({ kind: "emoji", value: "🧪" }, "Zebra"),
		).toEqual({
			kind: "emoji",
			value: "🧪",
			color: undefined,
			scale: 0.72,
		});
	});
});
