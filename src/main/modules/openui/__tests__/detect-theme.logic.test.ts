import { describe, expect, it } from "vitest";
import { THEME_PATTERN, detectTheme } from "../detect-theme";

describe("detectTheme", () => {
	it("matches the CardBlock positional theme", () => {
		const content =
			'root = CardBlock("Title", "Desc", [TextBlock("Body")], "glass")';

		expect(THEME_PATTERN.test(content)).toBe(true);
		expect(detectTheme(content)).toBe("glass");
	});

	it("falls back to shadcn for missing or unknown themes", () => {
		expect(detectTheme('root = CardBlock("Title", "Desc", [])')).toBe("shadcn");
		expect(
			detectTheme(
				'root = CardBlock("Title", "Desc", [TextBlock("Body")], "neon")',
			),
		).toBe("shadcn");
	});
});
