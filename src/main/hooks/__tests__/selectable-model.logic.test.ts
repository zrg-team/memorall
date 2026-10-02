import { describe, expect, it } from "vitest";
import { findSelectedModel } from "../selectable-model";

describe("findSelectedModel", () => {
	it("finds a model whose listing names a different provider than the selection", () => {
		// OpenRouter's listing labels its models "openai"; the selection made on
		// the Models page is under "openrouter".
		const listed = [{ id: "z-ai/glm-5.3-flash", provider: "openai" as const }];

		expect(findSelectedModel(listed, "z-ai/glm-5.3-flash", "openrouter")).toBe(
			listed[0],
		);
	});

	it("prefers the selected provider when two list the same id", () => {
		const listed = [
			{ id: "shared-model", provider: "lmstudio" as const },
			{ id: "shared-model", provider: "ollama" as const },
		];

		expect(findSelectedModel(listed, "shared-model", "ollama")).toBe(listed[1]);
	});

	it("finds nothing for a model the listing does not have", () => {
		expect(
			findSelectedModel([{ id: "other", provider: "openai" as const }], "x"),
		).toBeUndefined();
	});
});
