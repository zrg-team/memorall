import { describe, expect, it } from "vitest";

import { getAbsorbedFeatures } from "../feature-absorption";

const memon = {
	name: "memon-feature",
	absorbsFeatures: ["web-feature", "fs-feature"],
} as any;
const web = { name: "web-feature" } as any;
const fs = { name: "fs-feature" } as any;

describe("getAbsorbedFeatures", () => {
	it("maps each absorbed feature to the enabled feature that took it", () => {
		const absorbed = getAbsorbedFeatures([memon, web, fs], {
			"memon-feature": true,
			"web-feature": true,
		});

		expect(absorbed.get("web-feature")).toBe(memon);
		expect(absorbed.get("fs-feature")).toBe(memon);
	});

	it("absorbs nothing while the absorbing feature is off", () => {
		const absorbed = getAbsorbedFeatures([memon, web, fs], {
			"memon-feature": false,
			"web-feature": true,
		});

		expect(absorbed.size).toBe(0);
	});

	it("leaves the direct tools alone when the settings keep them", () => {
		const absorbed = getAbsorbedFeatures(
			[memon, web, fs],
			{ "memon-feature": true },
			[
				{
					name: "memon-feature",
					config: { keepDirectTools: true },
				},
			],
		);

		expect(absorbed.size).toBe(0);
	});
});
