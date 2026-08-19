import { BuiltinActionType } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import {
	buildButtonActionPlan,
	MEMORALL_OPENUI_ACTION_TYPE,
	normalizeOpenUIExternalUrl,
	parseOpenUIButtonAction,
} from "../actions";

// The OpenUI parser does not validate props against a component's zod schema, so
// whatever the model wrote reaches the click handler verbatim. These cover the
// near-misses that used to render a button whose click silently did nothing.
describe("parseOpenUIButtonAction", () => {
	it("accepts the canonical shape", () => {
		expect(
			parseOpenUIButtonAction({ type: "open_link", url: "https://a.test/x" }),
		).toEqual({ type: "open_link", url: "https://a.test/x" });
	});

	it("maps action type synonyms onto the supported union", () => {
		expect(
			parseOpenUIButtonAction({ type: "open_url", url: "https://a.test/x" }),
		).toEqual({ type: "open_link", url: "https://a.test/x" });
		expect(parseOpenUIButtonAction({ type: "toast", message: "hi" })).toEqual({
			type: "show_toast",
			message: "hi",
		});
	});

	it("resolves navigate by the field it carries", () => {
		expect(
			parseOpenUIButtonAction({ type: "navigate", url: "https://a.test" }),
		).toEqual({ type: "open_link", url: "https://a.test" });
		expect(parseOpenUIButtonAction({ type: "navigate", route: "/" })).toEqual({
			type: "open_route",
			route: "/",
		});
	});

	it("accepts field synonyms", () => {
		expect(
			parseOpenUIButtonAction({ type: "open_link", href: "https://a.test" }),
		).toEqual({ type: "open_link", url: "https://a.test" });
		expect(
			parseOpenUIButtonAction({ type: "send_message", prompt: "Compare both" }),
		).toEqual({ type: "send_message", message: "Compare both" });
	});

	it("keeps the form-submit shape intact", () => {
		expect(
			parseOpenUIButtonAction({
				type: "send_message",
				valueInput: "prompt",
				includeFormState: true,
			}),
		).toEqual({
			type: "send_message",
			valueInput: "prompt",
			includeFormState: true,
		});
	});

	it("recovers an action the model JSON-encoded into a string", () => {
		expect(
			parseOpenUIButtonAction('{"type":"open_link","url":"https://a.test"}'),
		).toEqual({ type: "open_link", url: "https://a.test" });
	});

	it("rejects a plain prompt string and an unusable action", () => {
		expect(parseOpenUIButtonAction("tell me more")).toBeNull();
		expect(parseOpenUIButtonAction({ type: "open_link" })).toBeNull();
		expect(parseOpenUIButtonAction({ type: "teleport" })).toBeNull();
	});
});

describe("normalizeOpenUIExternalUrl", () => {
	it("keeps http(s) URLs", () => {
		expect(normalizeOpenUIExternalUrl(" https://a.test/x ")).toBe(
			"https://a.test/x",
		);
	});

	it("upgrades a schemeless host to https", () => {
		expect(normalizeOpenUIExternalUrl("www.mogi.vn/nha-dat")).toBe(
			"https://www.mogi.vn/nha-dat",
		);
	});

	it("rejects non-http schemes and plain labels", () => {
		expect(normalizeOpenUIExternalUrl("javascript:alert(1)")).toBeNull();
		expect(normalizeOpenUIExternalUrl("Bang gia dat 2026")).toBeNull();
		expect(normalizeOpenUIExternalUrl("")).toBeNull();
	});
});

describe("buildButtonActionPlan", () => {
	it("sends the label as a prompt when the button has no action", () => {
		expect(buildButtonActionPlan(undefined, "Compare both")).toEqual({
			userMessage: "Compare both",
			action: { type: BuiltinActionType.ContinueConversation, params: {} },
		});
	});

	it("keeps a plain prompt string as the message", () => {
		expect(buildButtonActionPlan("tell me more", "More")).toEqual({
			userMessage: "tell me more",
			action: { type: BuiltinActionType.ContinueConversation, params: {} },
		});
	});

	it("carries a valid action through as a Memorall action", () => {
		expect(
			buildButtonActionPlan(
				{ type: "open_link", url: "https://a.test" },
				"Source",
			),
		).toEqual({
			userMessage: "https://a.test",
			action: {
				type: MEMORALL_OPENUI_ACTION_TYPE,
				params: { action: { type: "open_link", url: "https://a.test" } },
			},
		});
	});

	it("falls back to the label instead of a dead click on an unusable action", () => {
		expect(
			buildButtonActionPlan(
				{ type: "teleport", to: "mars" } as never,
				"Source A",
			),
		).toEqual({
			userMessage: "Source A",
			action: { type: BuiltinActionType.ContinueConversation, params: {} },
		});
	});
});
