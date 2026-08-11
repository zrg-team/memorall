import { describe, expect, it } from "vitest";
import { isLazyChunkLoadError } from "../LazyRouteErrorBoundary";

describe("isLazyChunkLoadError", () => {
	it("recognizes webpack chunk load failures", () => {
		expect(isLazyChunkLoadError(new Error("Loading chunk 55944 failed."))).toBe(
			true,
		);
	});

	it("does not mask unrelated route errors", () => {
		expect(isLazyChunkLoadError(new Error("Invalid route state"))).toBe(false);
	});
});
