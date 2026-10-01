import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/main/i18n/config", () => ({}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			String(options?.defaultValue ?? key).replace(
				/\{\{(\w+)\}\}/g,
				(_, name: string) => String(options?.[name] ?? ""),
			),
	}),
}));

import { OpenUIRenderer } from "../OpenUIRenderer";

beforeAll(() => {
	// Charts measure their box; jsdom has no layout.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

/**
 * A visual a model wrote, with the mistakes models make: quotes left inside
 * a string, a table given a title first, a table inside a collapsible, and a
 * chart whose data is not a list. All of it that can draw, draws.
 */
const VISUAL = `root = CardBlock("Agent cost comparison", "USD per 1M tokens", [section_intro, section_longctx, section_full, section_broken, section_note])

section_intro = AlertBlock("What matters", "Priority processing is now called "Fast mode" (renamed Jul 30).", "default")

section_longctx = TableBlock("Long-context pricing ($ per 1M tokens)", [Col("Model"), Col("Input", "right")], [["gpt-6-astra", "$20.00"], ["gpt-6-sol", "$4.00"]])

section_full = CollapsibleBlock("Full price table", [TableBlock([Col("Model"), Col("Output", "right")], [["o3", "$8.00"]])])

section_broken = BarChartBlock("Broken chart", "not a list")

section_note = TextContent("Example agent turn: 50,000 input tokens.", "sm")`;

describe("OpenUIRenderer with a visual that is partly wrong", () => {
	it("draws every part it can and lists the ones it cannot", () => {
		const { container } = render(
			<OpenUIRenderer content={VISUAL} streaming={false} />,
		);

		expect(screen.getByText("Agent cost comparison")).toBeTruthy();
		// The quoted words stay in the alert's text.
		expect(container.textContent).toContain(
			'Priority processing is now called "Fast mode" (renamed Jul 30).',
		);
		// A title first: the title, the columns and the rows all show.
		expect(
			screen.getByText("Long-context pricing ($ per 1M tokens)"),
		).toBeTruthy();
		expect(screen.getByText("gpt-6-astra")).toBeTruthy();
		expect(screen.getByText("$4.00")).toBeTruthy();
		expect(
			screen.getByText("Example agent turn: 50,000 input tokens."),
		).toBeTruthy();
		// A chart without a list of data still shows its title.
		expect(screen.getByText("Broken chart")).toBeTruthy();
		// Nothing fell back to the source.
		expect(container.textContent).not.toContain("root = CardBlock");
	});
});
