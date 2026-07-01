import { describe, expect, it, vi } from "vitest";

import {
	getAgentFeatureDescription,
	getAgentFeatureDisplayName,
} from "../feature-display";

describe("agent feature display helpers", () => {
	it("uses translation keys with defaults when available", () => {
		const t = vi.fn(
			(key: string, options: Record<string, unknown>) =>
				`${key}:${options.defaultValue}`,
		);
		const feature = {
			nameKey: "feature.name",
			displayName: "Feature",
			descriptionKey: "feature.description",
			description: "Description",
		} as any;

		expect(getAgentFeatureDisplayName(feature, t as any)).toBe(
			"feature.name:Feature",
		);
		expect(getAgentFeatureDescription(feature, t as any)).toBe(
			"feature.description:Description",
		);
		expect(t).toHaveBeenCalledWith("feature.name", {
			ns: "chat",
			defaultValue: "Feature",
		});
	});

	it("falls back to literal display text without translation keys", () => {
		const t = vi.fn();
		const feature = {
			displayName: "Feature",
			description: "Description",
		} as any;

		expect(getAgentFeatureDisplayName(feature, t as any)).toBe("Feature");
		expect(getAgentFeatureDescription(feature, t as any)).toBe("Description");
		expect(t).not.toHaveBeenCalled();
	});
});
