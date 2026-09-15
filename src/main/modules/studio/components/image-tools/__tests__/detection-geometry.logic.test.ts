import { describe, expect, it } from "vitest";
import {
	countDetectionsByLabel,
	detectionHue,
	formatScore,
	positionFromPointer,
	scaleDetectionBox,
	stepComparePosition,
} from "../detection-geometry";

describe("scaleDetectionBox", () => {
	it("scales pixel coordinates to the displayed size", () => {
		expect(
			scaleDetectionBox(
				{ xmin: 100, ymin: 50, xmax: 300, ymax: 250 },
				{ width: 1000, height: 500 },
				{ width: 500, height: 250 },
			),
		).toEqual({ left: 50, top: 25, width: 100, height: 100 });
	});

	it("scales each axis independently", () => {
		expect(
			scaleDetectionBox(
				{ xmin: 0, ymin: 0, xmax: 200, ymax: 200 },
				{ width: 400, height: 400 },
				{ width: 800, height: 200 },
			),
		).toEqual({ left: 0, top: 0, width: 400, height: 100 });
	});

	it("clamps boxes that spill outside the image", () => {
		expect(
			scaleDetectionBox(
				{ xmin: -20, ymin: 90, xmax: 120, ymax: 140 },
				{ width: 100, height: 100 },
				{ width: 100, height: 100 },
			),
		).toEqual({ left: 0, top: 90, width: 100, height: 10 });
	});

	it("normalises inverted boxes", () => {
		expect(
			scaleDetectionBox(
				{ xmin: 60, ymin: 40, xmax: 20, ymax: 10 },
				{ width: 100, height: 100 },
				{ width: 100, height: 100 },
			),
		).toEqual({ left: 20, top: 10, width: 40, height: 30 });
	});

	it("returns an empty rect before the natural size is known", () => {
		expect(
			scaleDetectionBox(
				{ xmin: 1, ymin: 1, xmax: 2, ymax: 2 },
				{ width: 0, height: 0 },
				{ width: 100, height: 100 },
			),
		).toEqual({ left: 0, top: 0, width: 0, height: 0 });
	});
});

describe("countDetectionsByLabel", () => {
	it("counts labels, most frequent first then alphabetical", () => {
		const box = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
		expect(
			countDetectionsByLabel([
				{ label: "dog", score: 0.9, box },
				{ label: "person", score: 0.9, box },
				{ label: "cat", score: 0.9, box },
				{ label: "person", score: 0.8, box },
			]),
		).toEqual([
			{ label: "person", count: 2 },
			{ label: "cat", count: 1 },
			{ label: "dog", count: 1 },
		]);
	});
});

describe("detectionHue", () => {
	it("is stable per label and within the hue circle", () => {
		expect(detectionHue("person")).toBe(detectionHue("person"));
		expect(detectionHue("person")).toBeGreaterThanOrEqual(0);
		expect(detectionHue("person")).toBeLessThan(360);
	});
});

describe("formatScore", () => {
	it("renders a rounded, clamped percentage", () => {
		expect(formatScore(0.876)).toBe("88%");
		expect(formatScore(1.2)).toBe("100%");
	});
});

describe("compare slider", () => {
	it("steps with arrows and jumps with Home/End", () => {
		expect(stepComparePosition(50, "ArrowRight")).toBe(52);
		expect(stepComparePosition(50, "ArrowLeft", true)).toBe(40);
		expect(stepComparePosition(99, "ArrowUp")).toBe(100);
		expect(stepComparePosition(30, "Home")).toBe(0);
		expect(stepComparePosition(30, "End")).toBe(100);
		expect(stepComparePosition(30, "Enter")).toBeNull();
	});

	it("maps a pointer to a clamped percentage", () => {
		expect(positionFromPointer(150, { left: 100, width: 200 })).toBe(25);
		expect(positionFromPointer(500, { left: 100, width: 200 })).toBe(100);
		expect(positionFromPointer(10, { left: 100, width: 0 })).toBe(50);
	});
});
