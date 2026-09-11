import { describe, expect, it } from "vitest";
import { coAgentStyles } from "../styles";

/**
 * The dock has to follow the user's theme, not assume a light page.
 *
 * It renders in a shadow root next to OpenUI blocks, which take their colours
 * from the shadcn tokens under the `.light`/`.dark` class. While the dock's own
 * CSS hard-coded a white-and-slate palette, a dark theme produced exactly the
 * mismatch this guards against: a light dock wrapped around a dark card.
 */

/** Declarations that paint a surface, as opposed to casting a shadow. */
const SURFACE_DECLARATION =
	/(?:^|[;{])\s*(background(?:-color)?|color|border(?:-top|-right|-bottom|-left)?(?:-color)?)\s*:\s*([^;}]+)/g;

const HARD_CODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

const surfaceDeclarations = (css: string): string[] => {
	const found: string[] = [];
	for (const match of css.matchAll(SURFACE_DECLARATION)) {
		const value = match[2];
		// Shadows stay a fixed dark in both themes, as shadows do everywhere.
		if (/shadow/.test(value)) continue;
		found.push(`${match[1]}: ${value.trim()}`);
	}
	return found;
};

describe("co-agent dock theming", () => {
	it("paints every surface from theme tokens", () => {
		const offenders = surfaceDeclarations(coAgentStyles).filter((decl) =>
			HARD_CODED_COLOR.test(decl),
		);

		expect(offenders).toEqual([]);
	});

	it("actually uses the shared tokens", () => {
		// Guards the inverse mistake: passing the check above by removing colour
		// declarations altogether rather than by tokenising them.
		expect(coAgentStyles).toContain("hsl(var(--foreground))");
		expect(coAgentStyles).toContain("hsl(var(--popover))");
		expect(coAgentStyles).toContain("hsl(var(--border)");
	});

	it("keeps shadows a fixed dark so they do not glow in dark mode", () => {
		const shadows = [
			...coAgentStyles.matchAll(/(box-shadow|filter)\s*:\s*([^;}]+)/g),
		]
			.map((match) => match[2])
			.filter((value) => /rgb|hsl|#/.test(value));

		expect(shadows.length).toBeGreaterThan(0);
		for (const shadow of shadows) {
			expect(shadow).not.toContain("--foreground");
		}
	});
});
