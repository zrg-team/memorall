import { render, screen, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { describe, expect, it, vi } from "vitest";
import { MermaidRenderer } from "../MermaidRenderer";

// The real mermaid library pulls in d3 and is heavy; mock it so we exercise the
// component's lazy-load + render/error flow without loading the actual bundle.
vi.mock("mermaid", () => ({
	default: {
		initialize: vi.fn(),
		render: vi.fn(async (_id: string, _chart: string) => ({
			svg: "<svg data-testid='mermaid-svg'><g>diagram</g></svg>",
		})),
	},
}));

const mockedMermaid = vi.mocked(mermaid, true);

describe("MermaidRenderer", () => {
	// Must run first: simply importing the module must NOT initialize mermaid
	// (previously `mermaid.initialize()` ran at module scope, forcing mermaid+d3
	// into the entry bundle). Initialization now happens lazily on first render.
	it("does not initialize mermaid at import time", () => {
		expect(mockedMermaid.initialize).not.toHaveBeenCalled();
	});

	it("lazily initializes mermaid and renders the diagram SVG", async () => {
		render(<MermaidRenderer chart="graph TD; A-->B" />);

		await waitFor(() =>
			expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument(),
		);
		expect(mockedMermaid.initialize).toHaveBeenCalled();
		expect(mockedMermaid.render).toHaveBeenCalledWith(
			expect.any(String),
			"graph TD; A-->B",
		);
	});

	it("falls back to a code block when the chart is empty", async () => {
		render(<MermaidRenderer chart="   " />);

		expect(await screen.findByText(/Render failed/i)).toBeInTheDocument();
		expect(screen.getByText(/Empty chart content/i)).toBeInTheDocument();
	});
});
