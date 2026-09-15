import { describe, expect, it } from "vitest";
import {
	aspectRatioOf,
	clampImageCount,
	downloadFileName,
	orientationOf,
	parseImageSize,
	IMAGE_SIZES,
	randomSeed,
	sizeParam,
} from "../image-generation-options";

describe("image sizes", () => {
	it("parses WxH and rejects auto", () => {
		expect(parseImageSize("1536x1024")).toEqual({ width: 1536, height: 1024 });
		expect(parseImageSize("auto")).toBeNull();
		expect(parseImageSize(undefined)).toBeNull();
	});

	it("derives aspect ratio and orientation", () => {
		expect(aspectRatioOf("1024x1792")).toBe("1024 / 1792");
		expect(aspectRatioOf("auto")).toBe("1 / 1");
		expect(orientationOf("384x384")).toBe("square");
		expect(orientationOf("1792x1024")).toBe("landscape");
		expect(orientationOf("1024x1536")).toBe("portrait");
		expect(orientationOf("auto")).toBe("auto");
	});
});

describe("size options", () => {
	it("offers the same generic sizes for every model and sends none for auto", () => {
		expect(IMAGE_SIZES[0]).toBe("auto");
		expect(sizeParam("auto")).toBeUndefined();
		expect(sizeParam("")).toBeUndefined();
		expect(sizeParam("1024x1024")).toBe("1024x1024");
	});
});

describe("helpers", () => {
	it("clamps the image count to 1-4", () => {
		expect(clampImageCount(0)).toBe(1);
		expect(clampImageCount(9)).toBe(4);
		expect(clampImageCount("2")).toBe(1);
		expect(clampImageCount(2.6)).toBe(3);
	});

	it("draws seeds in the 31-bit range", () => {
		expect(randomSeed(() => 0)).toBe(0);
		expect(randomSeed(() => 0.9999999999)).toBeLessThan(2 ** 31);
	});

	it("builds readable download names", () => {
		expect(downloadFileName("A Fox, in the Snow!", "image/png", "2")).toBe(
			"a-fox-in-the-snow-2.png",
		);
		expect(downloadFileName("Ảnh chụp.jpeg", "image/jpeg")).toBe(
			"anh-chup.jpg",
		);
		expect(downloadFileName("", "image/webp")).toBe("image.webp");
	});
});
