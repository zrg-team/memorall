import { describe, expect, it } from "vitest";
import { parseKnowledgeContext, readableRelation } from "../knowledge-context";

// Exactly what entities-facts-to-context writes, including an entity with no
// summary — the `: .` lines that made the raw view unreadable.
const CONTEXT = `
<definitions>"grand-rts-game project" (project): .
"baseline review 2026-09-12 scoring combined 61.825/100" (metric): Combined score across 12 dimensions..
"Vạn Thắng (Ten Thousand Victories) — grand-strategy roguelite" (project): A Vietnamese-history roguelite.</definitions>
<facts>"grand-rts-game project" HAS_BASELINE "baseline review 2026-09-12 scoring combined 61.825/100", Scored in the phase-1 review.
"grand-rts-game project" RELATED_TO "Vạn Thắng (Ten Thousand Victories) — grand-strategy roguelite", .</facts>`;

describe("reading a knowledge context", () => {
	it("reads entities, keeping names that contain parentheses", () => {
		expect(parseKnowledgeContext(CONTEXT)?.entities).toEqual([
			{ name: "grand-rts-game project", type: "project", summary: "" },
			{
				name: "baseline review 2026-09-12 scoring combined 61.825/100",
				type: "metric",
				summary: "Combined score across 12 dimensions.",
			},
			{
				name: "Vạn Thắng (Ten Thousand Victories) — grand-strategy roguelite",
				type: "project",
				summary: "A Vietnamese-history roguelite",
			},
		]);
	});

	it("reads relationships, with an empty fact left empty", () => {
		expect(parseKnowledgeContext(CONTEXT)?.relationships).toEqual([
			{
				source: "grand-rts-game project",
				relation: "HAS_BASELINE",
				target: "baseline review 2026-09-12 scoring combined 61.825/100",
				fact: "Scored in the phase-1 review",
			},
			{
				source: "grand-rts-game project",
				relation: "RELATED_TO",
				target: "Vạn Thắng (Ten Thousand Victories) — grand-strategy roguelite",
				fact: "",
			},
		]);
	});

	it("keeps a summary that runs over several lines together", () => {
		const parsed = parseKnowledgeContext(
			'<definitions>"A" (note): first line\nsecond line.</definitions>',
		);
		expect(parsed?.entities).toEqual([
			{ name: "A", type: "note", summary: "first line\nsecond line" },
		]);
	});

	it("reads a context with only one of the two sections", () => {
		const parsed = parseKnowledgeContext('<facts>"A" USES "B", daily.</facts>');
		expect(parsed).toEqual({
			entities: [],
			relationships: [
				{ source: "A", relation: "USES", target: "B", fact: "daily" },
			],
			notes: "",
		});
	});

	it("keeps text outside the sections", () => {
		expect(
			parseKnowledgeContext(
				'Recent memory:\n<definitions>"A" (x): .</definitions>',
			)?.notes,
		).toBe("Recent memory:");
	});

	it.each([
		["plain text", "The game uses a fixed-timestep simulation."],
		[
			"a section in another format",
			"<definitions>A is a project</definitions>",
		],
		["an empty string", ""],
	])("does not guess at %s", (_label, text) => {
		expect(parseKnowledgeContext(text)).toBeNull();
	});
});

describe("relation labels", () => {
	it.each([
		["HAS_WEAK_POINT", "has weak point"],
		["related to", "related to"],
		["worksAt", "worksAt"],
	])("reads %s as %s", (relation, label) => {
		expect(readableRelation(relation)).toBe(label);
	});
});
