import { describe, expect, it } from "vitest";
import {
	clampRectToViewport,
	formatRectSize,
	isBelowMinimumSelection,
	MIN_SELECTION_PX,
	normalizeDragRect,
} from "../drag-rect";

describe("normalizeDragRect", () => {
	it("describes the same rectangle whichever way the drag went", () => {
		const topLeft = { x: 100, y: 50 };
		const bottomRight = { x: 300, y: 200 };
		const topRight = { x: 300, y: 50 };
		const bottomLeft = { x: 100, y: 200 };
		const expected = { left: 100, top: 50, width: 200, height: 150 };

		expect(normalizeDragRect(topLeft, bottomRight)).toEqual(expected);
		expect(normalizeDragRect(bottomRight, topLeft)).toEqual(expected);
		expect(normalizeDragRect(topRight, bottomLeft)).toEqual(expected);
		expect(normalizeDragRect(bottomLeft, topRight)).toEqual(expected);
	});

	it("collapses a drag that never moved", () => {
		expect(normalizeDragRect({ x: 40, y: 40 }, { x: 40, y: 40 })).toEqual({
			left: 40,
			top: 40,
			width: 0,
			height: 0,
		});
	});
});

describe("clampRectToViewport", () => {
	it("keeps a rect that is already on screen", () => {
		const rect = { left: 10, top: 20, width: 100, height: 80 };
		expect(clampRectToViewport(rect, 1000, 800)).toEqual(rect);
	});

	it("trims a drag released past the right and bottom edges", () => {
		expect(
			clampRectToViewport(
				{ left: 900, top: 700, width: 400, height: 400 },
				1000,
				800,
			),
		).toEqual({ left: 900, top: 700, width: 100, height: 100 });
	});

	it("trims a drag that started off the top left", () => {
		expect(
			clampRectToViewport(
				{ left: -50, top: -30, width: 200, height: 100 },
				1000,
				800,
			),
		).toEqual({ left: 0, top: 0, width: 150, height: 70 });
	});

	it("gives back nothing for a rect entirely off screen", () => {
		const clamped = clampRectToViewport(
			{ left: 1200, top: 900, width: 100, height: 100 },
			1000,
			800,
		);
		expect(clamped.width).toBe(0);
		expect(clamped.height).toBe(0);
	});
});

describe("isBelowMinimumSelection", () => {
	it("rejects a rect narrower or shorter than the minimum", () => {
		const under = MIN_SELECTION_PX - 1;
		expect(
			isBelowMinimumSelection({ left: 0, top: 0, width: under, height: 100 }),
		).toBe(true);
		expect(
			isBelowMinimumSelection({ left: 0, top: 0, width: 100, height: under }),
		).toBe(true);
	});

	it("accepts a rect exactly at the minimum", () => {
		expect(
			isBelowMinimumSelection({
				left: 0,
				top: 0,
				width: MIN_SELECTION_PX,
				height: MIN_SELECTION_PX,
			}),
		).toBe(false);
	});

	it("accepts a rect above the minimum", () => {
		const over = MIN_SELECTION_PX + 1;
		expect(
			isBelowMinimumSelection({ left: 0, top: 0, width: over, height: over }),
		).toBe(false);
	});
});

describe("formatRectSize", () => {
	it("rounds to whole pixels", () => {
		expect(
			formatRectSize({ left: 0, top: 0, width: 199.6, height: 100.2 }),
		).toBe("200 × 100");
	});
});
