import { describe, expect, it } from "vitest";
import { rewriteColors, selectionRect } from "../capture-screen";

describe("rewriteColors", () => {
	it("replaces every CSS Color 4 function and leaves other colors alone", () => {
		const toRgba = (color: string) => `rgba(<${color}>)`;
		expect(rewriteColors("oklch(0.5 0.1 200)", toRgba)).toBe(
			"rgba(<oklch(0.5 0.1 200)>)",
		);
		expect(
			rewriteColors(
				"linear-gradient(135deg, oklab(0.6 0.1 0.1 / 0.12), rgb(0, 0, 0) 60%)",
				toRgba,
			),
		).toBe(
			"linear-gradient(135deg, rgba(<oklab(0.6 0.1 0.1 / 0.12)>), rgb(0, 0, 0) 60%)",
		);
		expect(
			rewriteColors("0 1px 2px color(srgb 1 0 0), 0 0 0 lab(50 10 10)", toRgba),
		).toBe("0 1px 2px rgba(<color(srgb 1 0 0)>), 0 0 0 rgba(<lab(50 10 10)>)");
		expect(rewriteColors("rgb(1, 2, 3)", toRgba)).toBe("rgb(1, 2, 3)");
	});
});

describe("selectionRect", () => {
	it("normalises a drag in any direction and keeps it on the desktop", () => {
		const bounds = { width: 800, height: 600 };
		expect(
			selectionRect({ x: 300, y: 200 }, { x: 100, y: 50 }, bounds),
		).toEqual({ x: 100, y: 50, width: 200, height: 150 });
		expect(
			selectionRect({ x: 700, y: 500 }, { x: 900, y: 700 }, bounds),
		).toEqual({ x: 700, y: 500, width: 100, height: 100 });
		expect(selectionRect({ x: -20, y: 10 }, { x: 40, y: 10 }, bounds)).toEqual({
			x: 0,
			y: 10,
			width: 40,
			height: 0,
		});
	});
});
