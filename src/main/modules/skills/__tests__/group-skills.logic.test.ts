import { describe, expect, it } from "vitest";
import {
	CUSTOM_GROUP_KEY,
	groupSkills,
	IN_USE_GROUP_KEY,
} from "@/main/modules/skills/utils/group-skills";
import type { SkillSummary } from "@/services/filesystem/skill-filesystem";

const skill = (
	name: string,
	overrides: Partial<SkillSummary> = {},
): SkillSummary => ({
	name,
	description: `${name} description`,
	path: `/home/skills/${name}.md`,
	origin: "default",
	...overrides,
});

const LABELS = { inUseLabel: "In use", customLabel: "Yours" };

const group = (skills: SkillSummary[], enabled: string[] = []) =>
	groupSkills(skills, { ...LABELS, enabledNames: new Set(enabled) });

describe("groupSkills", () => {
	it("puts the agent's enabled skills first, then custom, then categories", () => {
		const groups = group(
			[
				skill("zeta", { collection: "design-skills" }),
				skill("alpha", { collection: "api-skills" }),
				skill("mine", { origin: "custom" }),
				skill("in-use-one", { collection: "design-skills" }),
			],
			["in-use-one"],
		);

		expect(groups.map((g) => g.key)).toEqual([
			IN_USE_GROUP_KEY,
			CUSTOM_GROUP_KEY,
			"api-skills",
			"design-skills",
		]);
		expect(groups[0].label).toBe("In use");
		expect(groups[1].label).toBe("Yours");
	});

	it("keeps an enabled skill out of its origin group so no row is listed twice", () => {
		const groups = group(
			[
				skill("mine", { origin: "custom" }),
				skill("also-mine", { origin: "custom" }),
			],
			["mine"],
		);

		expect(groups.find((g) => g.key === IN_USE_GROUP_KEY)?.skills).toHaveLength(
			1,
		);
		expect(
			groups.find((g) => g.key === CUSTOM_GROUP_KEY)?.skills.map((s) => s.name),
		).toEqual(["also-mine"]);
	});

	// Rendering the whole bundled library on arrival is what made the list slow.
	it("opens only the user-scoped groups by default", () => {
		const groups = group(
			[
				skill("in-use-one", { collection: "design-skills" }),
				skill("mine", { origin: "custom" }),
				skill("bundled", { collection: "design-skills" }),
			],
			["in-use-one"],
		);

		const expanded = Object.fromEntries(
			groups.map((g) => [g.key, g.defaultExpanded]),
		);
		expect(expanded[IN_USE_GROUP_KEY]).toBe(true);
		expect(expanded[CUSTOM_GROUP_KEY]).toBe(true);
		expect(expanded["design-skills"]).toBe(false);
	});

	it("falls back through collection, publisher, then author for a category name", () => {
		const groups = group([
			skill("a", { collection: "design-skills" }),
			skill("b", { publisher: "anthropic" }),
			skill("c", { author: "karpathy" }),
			skill("d"),
		]);

		expect(groups.map((g) => g.label).sort()).toEqual([
			"Other",
			"anthropic",
			"design-skills",
			"karpathy",
		]);
	});

	it("sorts skills by name inside each group", () => {
		const groups = group([
			skill("c", { collection: "x" }),
			skill("a", { collection: "x" }),
			skill("b", { collection: "x" }),
		]);

		expect(groups[0].skills.map((s) => s.name)).toEqual(["a", "b", "c"]);
	});

	it("returns nothing when there are no skills", () => {
		expect(group([])).toEqual([]);
	});
});
