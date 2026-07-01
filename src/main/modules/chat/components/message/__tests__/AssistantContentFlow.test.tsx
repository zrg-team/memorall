import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AssistantContentFlow,
	type AssistantContentPart,
} from "../AssistantContentFlow";

const textMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("../MessageContentWithArtifacts", async () => {
	const ReactModule = await import("react");
	return {
		MessageContentWithArtifacts: ({ content }: { content: string }) => {
			ReactModule.useEffect(() => {
				textMounts.count += 1;
			}, []);
			return ReactModule.createElement(
				"div",
				{ "data-testid": "assistant-text" },
				content,
			);
		},
	};
});

vi.mock("../AssistantWorkflow", () => ({
	AssistantWorkflowPart: () => <div data-testid="workflow" />,
	AssistantWorkflowSummary: () => null,
	isWorkflowEvidencePart: () => false,
}));

vi.mock("../AssistantToolTimelinePart", () => ({
	AssistantToolTimelinePart: () => <div data-testid="tool" />,
}));

describe("AssistantContentFlow", () => {
	beforeEach(() => {
		textMounts.count = 0;
	});

	it("does not remount existing text content when execution/tool parts are appended", () => {
		const { rerender } = render(
			<AssistantContentFlow
				parts={[{ type: "text", text: "hello" }]}
				isStreaming={true}
			/>,
		);

		expect(screen.getByTestId("assistant-text")).toHaveTextContent("hello");
		expect(textMounts.count).toBe(1);

		const nextParts: AssistantContentPart[] = [
			{ type: "text", text: "hello world" },
			{
				type: "execution",
				id: "step-1",
				node: "step-1",
				state: "running",
			},
			{
				type: "tool",
				id: "tool-1",
				name: "lookup",
				input: {},
				output: "done",
			},
		] as AssistantContentPart[];

		rerender(<AssistantContentFlow parts={nextParts} isStreaming={true} />);

		expect(screen.getByTestId("assistant-text")).toHaveTextContent(
			"hello world",
		);
		expect(textMounts.count).toBe(1);
	});
});
