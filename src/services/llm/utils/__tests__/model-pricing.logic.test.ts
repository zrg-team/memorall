import { describe, expect, it } from "vitest";
import {
	formatPerMillion,
	isFreeModel,
	readModelPricing,
} from "../model-pricing";

describe("a model's price from its listing", () => {
	it("reads per-token prices as per million tokens", () => {
		expect(
			readModelPricing({
				id: "openai/gpt-4o-mini",
				pricing: {
					prompt: "0.00000015",
					completion: "0.0000006",
					input_cache_read: "0.000000075",
					request: "0",
				},
			}),
		).toEqual({
			inputPerMillion: 0.15,
			outputPerMillion: 0.6,
			cachedInputPerMillion: 0.075,
		});
	});

	it("knows a free model, and leaves out a cache price that is no discount", () => {
		const free = readModelPricing({
			pricing: { prompt: "0", completion: "0", input_cache_read: "0" },
		});
		expect(free).toEqual({ inputPerMillion: 0, outputPerMillion: 0 });
		expect(isFreeModel(free as never)).toBe(true);
	});

	it("gives nothing for a price that varies or is not listed", () => {
		// A router that picks the model per request has no price of its own.
		expect(
			readModelPricing({ pricing: { prompt: "-1", completion: "-1" } }),
		).toBeUndefined();
		expect(
			readModelPricing({ pricing: { prompt: "0.000001" } }),
		).toBeUndefined();
		expect(readModelPricing({ id: "gpt-4o" })).toBeUndefined();
		expect(readModelPricing(null)).toBeUndefined();
	});

	it("labels prices without float noise", () => {
		expect(formatPerMillion(0.15)).toBe("$0.15");
		expect(formatPerMillion(3)).toBe("$3");
		expect(formatPerMillion(0.075)).toBe("$0.075");
		expect(formatPerMillion(12.3456)).toBe("$12.3");
	});
});
