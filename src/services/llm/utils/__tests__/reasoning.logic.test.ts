import { describe, expect, it } from "vitest";
import { readModelReasoning, readReasoningDelta } from "../reasoning";

describe("readReasoningDelta", () => {
	it("reads OpenRouter's reasoning string without doubling its details", () => {
		expect(
			readReasoningDelta({
				content: "",
				reasoning: "Let me think",
				reasoning_details: [{ type: "reasoning.text", text: "Let me think" }],
			}),
		).toBe("Let me think");
	});

	it("reads reasoning_content, the shape local servers use", () => {
		expect(readReasoningDelta({ reasoning_content: "Step one" })).toBe(
			"Step one",
		);
	});

	it("reads readable details when only they are sent, skipping encrypted ones", () => {
		expect(
			readReasoningDelta({
				reasoning_details: [
					{ type: "reasoning.summary", summary: "Plan. " },
					{ type: "reasoning.encrypted", data: "opaque" },
					{ type: "reasoning.text", text: "Then act." },
				],
			}),
		).toBe("Plan. Then act.");
	});

	it("is empty for a delta without reasoning", () => {
		expect(readReasoningDelta({ content: "Hello" })).toBe("");
		expect(readReasoningDelta(undefined)).toBe("");
	});
});

describe("readModelReasoning", () => {
	it("takes the efforts a listing declares, lowest first", () => {
		expect(
			readModelReasoning({
				id: "example/model",
				reasoning: {
					supported_efforts: ["high", "low", "none", "medium"],
					default_effort: "medium",
				},
			}),
		).toEqual({
			efforts: ["none", "low", "medium", "high"],
			defaultEffort: "medium",
		});
	});

	it("offers no Off for a model that always thinks", () => {
		// z-ai/glm-5.3-flash, as OpenRouter lists it.
		expect(
			readModelReasoning({
				reasoning: {
					mandatory: true,
					default_enabled: true,
					supported_efforts: ["max", "high", "low"],
					default_effort: "max",
				},
			}),
		).toEqual({
			efforts: ["low", "high", "max"],
			defaultEffort: "max",
			mandatory: true,
		});
	});

	it("offers Off whenever reasoning is optional, even with no levels listed", () => {
		// z-ai/glm-4.7-flash: reasoning can be switched off, but has no levels.
		expect(
			readModelReasoning({
				reasoning: { mandatory: false, default_enabled: true },
				supported_parameters: ["include_reasoning", "reasoning"],
			}),
		).toEqual({ efforts: ["none"] });
		// z-ai/glm-5.2: optional, with levels that do not include "none".
		expect(
			readModelReasoning({
				reasoning: {
					mandatory: false,
					supported_efforts: ["xhigh", "high"],
					default_effort: "high",
				},
			}),
		).toEqual({ efforts: ["none", "high", "xhigh"], defaultEffort: "high" });
	});

	it("never offers levels a described model does not list", () => {
		// Sending one it does not list is a validation error.
		expect(
			readModelReasoning({ reasoning: { mandatory: true } }),
		).toBeUndefined();
	});

	it("gives the standard levels to a listing that only takes reasoning_effort", () => {
		expect(
			readModelReasoning({
				supported_parameters: ["tools", "reasoning_effort"],
			}),
		).toEqual({ efforts: ["low", "medium", "high"] });
	});

	it("is undefined when nothing can be chosen", () => {
		expect(
			readModelReasoning({ id: "gpt-4o", supported_parameters: ["tools"] }),
		).toBeUndefined();
		expect(
			readModelReasoning({ supported_parameters: ["reasoning"] }),
		).toBeUndefined();
	});
});
