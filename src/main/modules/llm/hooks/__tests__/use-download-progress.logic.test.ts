import { describe, expect, it } from "vitest";
import { isChatModelDownload } from "../use-download-progress";

describe("isChatModelDownload", () => {
	it("keeps the app-wide download screen for chat model loads only", () => {
		expect(
			isChatModelDownload({ category: "chat", provider: "transformer-media" }),
		).toBe(true);
		expect(
			isChatModelDownload({ category: "speech-to-text", provider: "openai" }),
		).toBe(false);
		expect(isChatModelDownload({ provider: "wllama" })).toBe(true);
		expect(isChatModelDownload({ provider: "transformer-media" })).toBe(false);
		expect(isChatModelDownload({})).toBe(true);
	});
});
