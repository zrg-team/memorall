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

vi.mock("../AssistantToolTimeline", () => ({
	AssistantToolTimeline: ({
		parts,
		isStreaming,
	}: {
		parts: Array<{ id: string }>;
		isStreaming: boolean;
	}) => (
		<div data-testid="tool" data-streaming={String(isStreaming)}>
			{parts.map((part) => part.id).join(",")}
		</div>
	),
}));

const tool = (id: string): AssistantContentPart =>
	({
		type: "tool",
		id,
		name: "fs_read",
		description: "",
		state: "complete",
	}) as AssistantContentPart;

const flowOrder = () =>
	Array.from(
		document.querySelectorAll(
			"[data-testid='assistant-text'], [data-testid='tool']",
		),
	).map((node) =>
		node.getAttribute("data-testid") === "tool"
			? `tools:${node.textContent}`
			: `text:${node.textContent}`,
	);

describe("AssistantContentFlow", () => {
	beforeEach(() => {
		textMounts.count = 0;
	});

	it("renders adjacent assistant text parts as one Markdown block", () => {
		render(
			<AssistantContentFlow
				parts={[
					{ type: "text", text: "## Recommendation" },
					{ type: "text", text: "First paragraph." },
				]}
				isStreaming={false}
			/>,
		);

		expect(screen.getAllByTestId("assistant-text")).toHaveLength(1);
		expect(screen.getByTestId("assistant-text")).toHaveTextContent(
			"## Recommendation First paragraph.",
		);
	});

	it("renders each group of tools between the text around it", () => {
		render(
			<AssistantContentFlow
				parts={[
					tool("a"),
					tool("b"),
					{ type: "text", text: "   " },
					tool("c"),
					{ type: "text", text: "I'll continue." },
					tool("d"),
					tool("e"),
					{ type: "text", text: "Full response." },
				]}
				isStreaming={false}
			/>,
		);

		expect(flowOrder()).toEqual([
			"tools:a,b,c",
			"text:I'll continue.",
			"tools:d,e",
			"text:Full response.",
		]);
	});

	it("keeps only the latest tool group open while streaming", () => {
		render(
			<AssistantContentFlow
				parts={[tool("a"), { type: "text", text: "Next." }, tool("b")]}
				isStreaming={true}
			/>,
		);

		expect(
			screen
				.getAllByTestId("tool")
				.map((node) => node.getAttribute("data-streaming")),
		).toEqual(["false", "true"]);
	});

	it("does not remount text when a tool group and more text follow it", () => {
		const { rerender } = render(
			<AssistantContentFlow
				parts={[{ type: "text", text: "Let me look." }]}
				isStreaming={true}
			/>,
		);

		rerender(
			<AssistantContentFlow
				parts={[
					{ type: "text", text: "Let me look." },
					tool("a"),
					{ type: "text", text: "Found it." },
				]}
				isStreaming={true}
			/>,
		);

		expect(flowOrder()).toEqual([
			"text:Let me look.",
			"tools:a",
			"text:Found it.",
		]);
		expect(textMounts.count).toBe(2);
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
