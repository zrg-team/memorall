import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComplexContentPartTool } from "@/types/chat";

// Same light dependency graph as the summary tests: the real tool renderers
// pull in pdfjs, which jsdom cannot load.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => undefined },
}));
vi.mock("@/services/flow-builder-catalog", () => ({ DEFAULT_FLOW_STEPS: [] }));
vi.mock("../../MessageActions", () => ({ ToolActionDetails: () => null }));
// Grouping is pure, but its module also imports the heavy renderers.
vi.mock("../MessageContentWithArtifacts", () => ({
	MessageContentWithArtifacts: () => null,
}));
vi.mock("../AssistantToolTimeline", () => ({
	AssistantToolTimeline: () => null,
}));

import { KNOWLEDGE_RETRIEVAL_TOOL_NAME } from "@memorall/agent-harness-flows/steps/common/context-to-system";
import {
	AssistantWorkflowSummary,
	isWorkflowEvidencePart,
} from "../AssistantWorkflow";
import {
	type AssistantContentPart,
	groupAssistantParts,
} from "../AssistantContentFlow";

const toolPart = (
	id: string,
	name: string,
	description = "",
): ComplexContentPartTool => ({
	type: "tool",
	id,
	name,
	description,
	state: "complete",
});

const timelineIds = (parts: AssistantContentPart[]): string[][] =>
	groupAssistantParts(parts)
		.filter((segment) => segment.kind === "tools")
		.map((segment) =>
			segment.kind === "tools" ? segment.parts.map((part) => part.id) : [],
		);

/**
 * Knowledge retrieval runs before the agent does anything — it is context, not
 * an action the agent chose. It used to render in the agent's tool timeline,
 * where it looked like a tool the agent called, and where rows are ordered by
 * when events arrived, which put it at the bottom.
 */
describe("knowledge retrieval is shown as context, not as an agent tool", () => {
	it("keeps it out of the agent's tool timeline", () => {
		const ids = timelineIds([
			toolPart("ret", "knowledge_retrieval"),
			toolPart("ls", "fs_ls"),
			toolPart("glob", "fs_glob"),
		]);

		expect(ids).toEqual([["ls", "glob"]]);
	});

	it("keeps it out wherever the stream delivered it", () => {
		// The reported case: retrieval arriving last. Placement no longer
		// depends on arrival order, so this cannot put it at the bottom again.
		const ids = timelineIds([
			toolPart("ls", "fs_ls"),
			toolPart("read", "fs_read"),
			toolPart("search", "web_search"),
			toolPart("ret", "knowledge_retrieval"),
		]);

		expect(ids).toEqual([["ls", "read", "search"]]);
	});

	it("shows it in the run summary above the answer", () => {
		render(
			<AssistantWorkflowSummary
				parts={[]}
				evidenceParts={[toolPart("ret", "knowledge_retrieval", "facts")]}
				isStreaming={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button"));
		expect(
			screen.getByText("workflow.evidence.knowledge_retrieval"),
		).toBeInTheDocument();
	});

	it("shows the retrieved facts, not the instructions written for the model", () => {
		const block = [
			"# Context",
			"Available Knowledge Context:",
			"<context>",
			"The game uses a fixed-timestep simulation.",
			"</context>",
			"",
			"## Context usage buideline",
			"Using the provided knowledge context, provide a comprehensive answer.",
		].join("\n");
		render(
			<AssistantWorkflowSummary
				parts={[]}
				evidenceParts={[toolPart("ret", "knowledge_retrieval", block)]}
				isStreaming={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button"));
		fireEvent.click(
			screen
				.getByText("workflow.evidence.knowledge_retrieval")
				.closest("button")!,
		);

		expect(
			screen.getByText("The game uses a fixed-timestep simulation."),
		).toBeInTheDocument();
		expect(screen.queryByText(/Context usage/)).toBeNull();
	});

	it("shows retrieved entities and relationships instead of their raw lines", () => {
		const block = [
			"<context>",
			'<definitions>"grand-rts-game project" (project): .',
			'"fun-proxy saturation" (issue): Skill ceiling 1.18x vs 1.3x target.</definitions>',
			'<facts>"grand-rts-game project" HAS_ISSUE "fun-proxy saturation", Found in review.</facts>',
			"</context>",
		].join("\n");
		render(
			<AssistantWorkflowSummary
				parts={[]}
				evidenceParts={[toolPart("ret", "knowledge_retrieval", block)]}
				isStreaming={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button"));
		fireEvent.click(
			screen
				.getByText("workflow.evidence.knowledge_retrieval")
				.closest("button")!,
		);

		expect(screen.getByText("workflow.knowledge.entities")).toBeInTheDocument();
		expect(
			screen.getByText("workflow.knowledge.relationships"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Skill ceiling 1.18x vs 1.3x target"),
		).toBeInTheDocument();
		expect(screen.getByText("has issue")).toBeInTheDocument();
		expect(screen.getByText("Found in review")).toBeInTheDocument();
		// None of the markup the model reads reaches the person.
		expect(screen.queryByText(/<definitions>|<facts>|\): \./)).toBeNull();
	});

	it("keeps a long retrieval short until asked for the rest", () => {
		const definitions = Array.from(
			{ length: 9 },
			(_, index) => `"entity ${index + 1}" (project): .`,
		).join("\n");
		render(
			<AssistantWorkflowSummary
				parts={[]}
				evidenceParts={[
					toolPart(
						"ret",
						"knowledge_retrieval",
						`<context><definitions>${definitions}</definitions></context>`,
					),
				]}
				isStreaming={false}
			/>,
		);
		fireEvent.click(screen.getByRole("button"));
		fireEvent.click(
			screen
				.getByText("workflow.evidence.knowledge_retrieval")
				.closest("button")!,
		);

		expect(screen.queryByText("entity 7")).toBeNull();
		fireEvent.click(screen.getByText("workflow.knowledge.showMore"));
		expect(screen.getByText("entity 9")).toBeInTheDocument();
	});

	it("does not repeat the retrieved content in the collapsed row", () => {
		// A multi-paragraph prompt truncated beside the label is noise; the
		// content belongs in the expanded details.
		render(
			<AssistantWorkflowSummary
				parts={[]}
				evidenceParts={[
					toolPart("ret", "knowledge_retrieval", "long retrieved block"),
				]}
				isStreaming={false}
			/>,
		);

		fireEvent.click(screen.getByRole("button"));
		expect(screen.queryByText("long retrieved block")).toBeNull();
	});
});

describe("workflow evidence classification", () => {
	it("matches the name the flow actually records the retrieval under", () => {
		// The flows package owns this name. If it is ever renamed there, this
		// fails here instead of the retrieval quietly reappearing in the timeline.
		expect(
			isWorkflowEvidencePart(toolPart("ret", KNOWLEDGE_RETRIEVAL_TOOL_NAME)),
		).toBe(true);
	});

	it.each([
		"knowledge_graph",
		"context_knowledge",
		"structmem_knowledge_retrieval",
	])("still treats %s as evidence", (name) => {
		expect(isWorkflowEvidencePart(toolPart("x", name))).toBe(true);
	});

	it.each(["fs_read", "web_search", "toString", "constructor", ""])(
		"does not treat %s as evidence",
		(name) => {
			// Includes inherited object keys: a plain object lookup would have
			// counted `toString` as a kind of evidence.
			expect(isWorkflowEvidencePart(toolPart("x", name))).toBe(false);
		},
	);
});
