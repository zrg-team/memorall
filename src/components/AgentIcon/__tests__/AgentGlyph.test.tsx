import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentGlyph } from "../AgentGlyph";

/**
 * The composer used to show a generic brain for every agent, so two agents with
 * truncated names were indistinguishable. The glyph's whole job is to differ
 * per agent, which is what these assert.
 */
describe("AgentGlyph", () => {
	it("shows the agent's emoji when it has one", () => {
		render(
			<AgentGlyph
				iconScreen={{ kind: "emoji", value: "📊" }}
				name="Economics"
			/>,
		);
		expect(screen.getByText("📊")).toBeInTheDocument();
	});

	it("shows a text screen in the agent's own colour", () => {
		render(
			<AgentGlyph
				iconScreen={{ kind: "text", value: "EC", color: "#ff8800" }}
				name="Economics"
			/>,
		);
		const glyph = screen.getByText("EC");
		expect(glyph).toBeInTheDocument();
		expect(glyph.style.color).toBe("rgb(255, 136, 0)");
	});

	it("falls back to the name's initial so it is never blank", () => {
		render(<AgentGlyph name="Research Assistant" />);
		expect(screen.getByText("R")).toBeInTheDocument();
	});

	it("gives two differently-named agents different marks with no icon set", () => {
		const { unmount } = render(<AgentGlyph name="My Economic Report" />);
		expect(screen.getByText("M")).toBeInTheDocument();
		unmount();
		render(<AgentGlyph name="Research Assistant" />);
		expect(screen.getByText("R")).toBeInTheDocument();
	});

	it("keeps a long text screen inside the square", () => {
		render(<AgentGlyph iconScreen={{ kind: "text", value: "LONGNAME" }} />);
		expect(screen.getByText("LO")).toBeInTheDocument();
	});
});
