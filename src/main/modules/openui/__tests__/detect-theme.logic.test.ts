import { describe, expect, it } from "vitest";
import { detectTheme, isKnownOpenUITheme } from "../detect-theme";

const block = (theme?: string) =>
	theme
		? `root = CardBlock("Title", "Desc", [TextBlock("x")], "${theme}")`
		: `root = CardBlock("Title", "Desc", [TextBlock("x")])`;

describe("detectTheme", () => {
	it("uses the theme the block names", () => {
		expect(detectTheme(block("glass"))).toBe("glass");
		expect(detectTheme(block("wireframe"))).toBe("wireframe");
	});

	it("falls back to the agent's configured theme when the block names none", () => {
		// The model is told to pass the theme and does not always remember. That
		// used to cost the agent its theme on every forgetful generation.
		expect(detectTheme(block(), "glass")).toBe("glass");
		expect(detectTheme(block(), "wireframe")).toBe("wireframe");
	});

	it("lets the block win over the configured theme", () => {
		expect(detectTheme(block("wireframe"), "glass")).toBe("wireframe");
	});

	it("still defaults to shadcn with nothing configured", () => {
		expect(detectTheme(block())).toBe("shadcn");
	});

	it("ignores a configured theme that is not a real theme", () => {
		expect(detectTheme(block(), "neon")).toBe("shadcn");
		expect(detectTheme(block(), "")).toBe("shadcn");
	});

	it("ignores a theme argument that is not a real theme", () => {
		expect(detectTheme(block("neon"), "glass")).toBe("glass");
	});

	it("recognises exactly the three known themes", () => {
		expect(isKnownOpenUITheme("shadcn")).toBe(true);
		expect(isKnownOpenUITheme("wireframe")).toBe(true);
		expect(isKnownOpenUITheme("glass")).toBe(true);
		expect(isKnownOpenUITheme("neon")).toBe(false);
		expect(isKnownOpenUITheme(undefined)).toBe(false);
	});
});
