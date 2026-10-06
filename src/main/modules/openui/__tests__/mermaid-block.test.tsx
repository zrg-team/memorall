import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/main/i18n/config", () => ({}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
// mermaid needs a real layout engine; the diagram's source is what matters here.
vi.mock("@/main/components/atoms/MermaidRenderer", () => ({
	MermaidRenderer: ({ chart }: { chart: string }) => (
		<pre data-testid="mermaid">{chart}</pre>
	),
}));

import { OpenUIRenderer } from "../OpenUIRenderer";
import { mermaidSource } from "../components/mermaid-block";

beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

const VISUAL = `root = CardBlock("Sign-in", null, [section_1])

section_1 = MermaidBlock("flowchart LR\\n  A[\\"Open (1)\\"] --> B{Valid?}\\n  B -->|yes| C[Home]", "How sign-in works")`;

describe("MermaidBlock", () => {
	it("draws the diagram a visual describes, with its title", () => {
		render(<OpenUIRenderer content={VISUAL} streaming={false} />);

		expect(screen.getByText("How sign-in works")).toBeTruthy();
		expect(screen.getByTestId("mermaid").textContent).toBe(
			'flowchart LR\n  A["Open (1)"] --> B{Valid?}\n  B -->|yes| C[Home]',
		);
	});

	it("waits for the source to finish streaming", () => {
		render(<OpenUIRenderer content={VISUAL} streaming />);

		expect(screen.queryByTestId("mermaid")).toBeNull();
		expect(screen.getByText("openui.drawingDiagram")).toBeTruthy();
	});

	it("takes a fenced or one-line source as Mermaid reads it", () => {
		expect(mermaidSource("```mermaid\ngraph TD\nA-->B\n```")).toBe(
			"graph TD\nA-->B",
		);
		expect(mermaidSource("graph TD\\nA-->B")).toBe("graph TD\nA-->B");
	});
});
