import { beforeEach, describe, expect, it } from "vitest";
import {
	assertSafeClickTarget,
	assertSafeTextInput,
} from "@/co-agent/dom/dom-utils";

/**
 * These two functions are the co-agent's only guard against acting on something
 * it should not touch, and they had no coverage at all. That mattered less while
 * the extension was the single caller; now the desktop app runs the same code
 * against the managed browser and against Memorall's own UI, so this file is the
 * contract all three hosts are held to.
 */

const mount = (html: string): HTMLElement => {
	document.body.innerHTML = html;
	const element = document.body.firstElementChild;
	if (!(element instanceof HTMLElement)) throw new Error("bad fixture");
	return element;
};

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("assertSafeClickTarget", () => {
	it("allows an ordinary button", () => {
		expect(() =>
			assertSafeClickTarget(mount('<button type="button">Show more</button>')),
		).not.toThrow();
	});

	it("blocks a disabled control", () => {
		expect(() =>
			assertSafeClickTarget(
				mount('<button type="button" disabled>Go</button>'),
			),
		).toThrow(/disabled/i);
	});

	it("blocks a submit button even when its label reads harmless", () => {
		expect(() =>
			assertSafeClickTarget(mount("<button>Continue</button>")),
		).toThrow(/user action/i);
	});

	it.each([
		["password"],
		["file"],
		["hidden"],
		["submit"],
		["reset"],
		["image"],
	])("blocks input[type=%s]", (type) => {
		expect(() =>
			assertSafeClickTarget(mount(`<input type="${type}" />`)),
		).toThrow(/user action/i);
	});

	it.each([
		["delete", '<button type="button">Delete account</button>'],
		["checkout", '<button type="button">Proceed to checkout</button>'],
		["login", '<a href="/x" aria-label="Log in">Go</a>'],
		["logout", '<button type="button" id="logout">Exit</button>'],
		["permission", '<button type="button" title="Allow location">OK</button>'],
	])("blocks a high-impact %s target on a third-party page", (_label, html) => {
		expect(() => assertSafeClickTarget(mount(html))).toThrow(/high impact/i);
	});

	it("still allows those same destructive labels inside Memorall's own UI", () => {
		// The broad third-party list would block almost every action a user would
		// ask an in-app co-pilot to take, which is why first-party narrows it.
		for (const html of [
			'<button type="button">Delete note</button>',
			'<button type="button">Clear topic</button>',
			'<button type="button">Confirm</button>',
		]) {
			expect(() =>
				assertSafeClickTarget(mount(html), "first-party"),
			).not.toThrow();
		}
	});

	it("keeps blocking genuinely irreversible targets in first-party mode", () => {
		for (const html of [
			'<button type="button">Buy credits</button>',
			'<button type="button">Reveal API key</button>',
		]) {
			expect(() => assertSafeClickTarget(mount(html), "first-party")).toThrow(
				/high impact/i,
			);
		}
	});

	it("honours an explicit opt-out on an ancestor", () => {
		document.body.innerHTML =
			'<div data-memorall-coagent="deny"><button type="button">Safe looking</button></div>';
		const button = document.querySelector("button");
		expect(button).not.toBeNull();
		expect(() => assertSafeClickTarget(button!, "first-party")).toThrow(
			/off limits/i,
		);
	});
});

describe("assertSafeTextInput", () => {
	it("allows a plain text field", () => {
		expect(() =>
			assertSafeTextInput(mount('<input type="text" name="note" />')),
		).not.toThrow();
	});

	it("rejects an element that cannot take text at all", () => {
		expect(() => assertSafeTextInput(mount("<div>hello</div>"))).toThrow(
			/does not support/i,
		);
	});

	it.each([
		["password", '<input type="text" name="password" />'],
		["otp", '<input type="text" placeholder="One-time token" />'],
		["credit card", '<input type="text" aria-label="Credit card number" />'],
		["ssn", '<input type="text" id="ssn" />'],
		["email", '<input type="text" autocomplete="email" />'],
	])("blocks a sensitive %s field", (_label, html) => {
		expect(() => assertSafeTextInput(mount(html))).toThrow(/sensitive/i);
	});

	it("keeps blocking sensitive fields inside Memorall's own UI too", () => {
		expect(() =>
			assertSafeTextInput(
				mount('<input type="text" name="password" />'),
				"first-party",
			),
		).toThrow(/sensitive/i);
	});
});
