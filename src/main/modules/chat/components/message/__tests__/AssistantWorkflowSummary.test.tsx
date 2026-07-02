import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComplexContentPartExecution } from "@/types/chat";

// Keep the summary's dependency graph light: the real MessageActions/flow catalog
// pull in the tool-renderer tree (pdfjs → DOMMatrix) which jsdom does not provide.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services/flow-builder-catalog", () => ({ DEFAULT_FLOW_STEPS: [] }));
vi.mock("../../MessageActions", () => ({ ToolActionDetails: () => null }));

import { AssistantWorkflowSummary } from "../AssistantWorkflow";

const execPart = (id: string, node: string): ComplexContentPartExecution =>
	({
		type: "execution",
		id,
		node,
		state: "complete",
	}) as ComplexContentPartExecution;

describe("AssistantWorkflowSummary", () => {
	it("toggles the run-details rows open and closed", () => {
		render(
			<AssistantWorkflowSummary
				parts={[execPart("e1", "custom-step"), execPart("e2", "another-step")]}
			/>,
		);

		// Collapsed by default: the step rows are not rendered.
		expect(screen.queryByText("Custom Step")).not.toBeInTheDocument();

		// Open.
		fireEvent.click(screen.getByRole("button"));
		expect(screen.getByText("Custom Step")).toBeInTheDocument();
		expect(screen.getByText("Another Step")).toBeInTheDocument();

		// Close.
		fireEvent.click(screen.getByRole("button"));
		expect(screen.queryByText("Custom Step")).not.toBeInTheDocument();
	});

	it("renders nothing when there are no parts", () => {
		const { container } = render(<AssistantWorkflowSummary parts={[]} />);
		expect(container).toBeEmptyDOMElement();
	});
});
