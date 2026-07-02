import { describe, expect, it } from "vitest";
import { contentVisibilityAuto } from "../content-visibility";

describe("contentVisibilityAuto", () => {
	it("returns content-visibility auto with an intrinsic-size placeholder", () => {
		expect(contentVisibilityAuto(96)).toEqual({
			contentVisibility: "auto",
			containIntrinsicSize: "auto 96px",
		});
	});

	it("reflects the provided intrinsic height", () => {
		expect(contentVisibilityAuto(40).containIntrinsicSize).toBe("auto 40px");
	});
});
