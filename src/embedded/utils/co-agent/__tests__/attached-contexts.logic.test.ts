import { describe, expect, it } from "vitest";
import type { EmbeddedContextItem } from "@/embedded/types";
import type { CoAgentContextAnchor } from "../context-anchor";
import { buildAttachedContexts } from "../attached-contexts";

const selection = (kind: string, label: string): EmbeddedContextItem =>
	({ id: "ctx-1", kind, label, content: "..." }) as EmbeddedContextItem;

const anchor = {
	kind: "hover",
	tagName: "div",
	text: "Triều Đại Của Trọng Nông",
} as unknown as CoAgentContextAnchor;

describe("recording what a turn carried", () => {
	it("records a captured region as a picture", () => {
		expect(
			buildAttachedContexts({
				selection: selection("selected_image", "Region 641×482"),
			}),
		).toEqual([{ kind: "screenshot", label: "Region 641×482" }]);
	});

	it("records picked text, which cannot be shown back in full", () => {
		expect(
			buildAttachedContexts({
				selection: selection("smart_text", "Smart Text: <p> Some prose"),
			}),
		).toEqual([{ kind: "text", label: "Smart Text: <p> Some prose" }]);
	});

	it("records picked markup as markup", () => {
		expect(
			buildAttachedContexts({
				selection: selection("smart_clean_html", "Clean HTML: <table>"),
			}),
		).toEqual([{ kind: "html", label: "Clean HTML: <table>" }]);
	});

	it("puts the hovered element first, as the subject of the question", () => {
		const refs = buildAttachedContexts({
			anchor,
			selection: selection("selected_image", "Region 641×482"),
		});

		expect(refs).toHaveLength(2);
		expect(refs[0].kind).toBe("anchor");
		expect(refs[1].kind).toBe("screenshot");
	});

	it("keeps the label the user attached it under", () => {
		// "Region 641×482" tells the reader which capture; "selected_image" does not.
		expect(
			buildAttachedContexts({
				selection: selection("selected_image", "Region 641×482"),
			})[0].label,
		).toBe("Region 641×482");
	});

	it("falls back to the kind's own name when a label is missing", () => {
		expect(
			buildAttachedContexts({ selection: selection("selected_image", "") })[0]
				.label,
		).toBe("Selected Region");
	});

	it("records nothing for a turn that carried nothing", () => {
		expect(buildAttachedContexts({})).toEqual([]);
		expect(buildAttachedContexts({ anchor: null, selection: null })).toEqual(
			[],
		);
	});
});
