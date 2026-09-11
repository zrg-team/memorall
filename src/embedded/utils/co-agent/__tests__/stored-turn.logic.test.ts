import { describe, expect, it } from "vitest";
import { buildEmbeddedContextMessageContent } from "@/embedded/context-items";
import { buildStoredTurn } from "../stored-turn";

const REGION = "data:image/png;base64,cropped";

const sentWithRegion = () =>
	buildEmbeddedContextMessageContent({
		userMessage: "what is this?",
		contexts: [
			{
				id: "ctx-1",
				kind: "selected_image",
				label: "Region 641×482",
				content: REGION,
			} as never,
		],
		pageTitle: "A listing",
		pageUrl: "https://example.com/listing",
	});

describe("writing down what was sent", () => {
	it("keeps an attached region with the turn", () => {
		const sent = sentWithRegion();
		const stored = buildStoredTurn("what is this?", sent);

		// Storing only the words is what made a captured region invisible in the
		// transcript while the model had answered about it.
		expect(stored.complexContent).toEqual(sent);
		expect(JSON.stringify(stored.complexContent)).toContain(REGION);
	});

	it("keeps the typed words as the turn's text", () => {
		// The text stays plain so search and the message list still read it.
		expect(buildStoredTurn("what is this?", sentWithRegion()).content).toBe(
			"what is this?",
		);
	});

	it("stores nothing extra for a turn that is only words", () => {
		expect(buildStoredTurn("hello", "hello")).toEqual({ content: "hello" });
	});

	it("stores nothing extra for an empty parts list", () => {
		expect(buildStoredTurn("hello", [])).toEqual({ content: "hello" });
	});
});

describe("what the model is handed for an attached region", () => {
	it("sends the region as an image, not as its description", () => {
		const sent = sentWithRegion();

		expect(Array.isArray(sent)).toBe(true);
		const parts = sent as Array<{ type: string; image_url?: { url: string } }>;
		const image = parts.find((part) => part.type === "image_url");
		expect(image?.image_url?.url).toBe(REGION);
	});
});
