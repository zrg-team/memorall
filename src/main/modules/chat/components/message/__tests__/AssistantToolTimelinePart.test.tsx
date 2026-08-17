import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ComplexContentPartTool } from "@/types/chat";
import { AssistantToolTimelinePart } from "../AssistantToolTimelinePart";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFileAsBase64: vi.fn(async () => ""),
	},
}));

// The renderer registry reaches the PDF tools, which pull pdfjs into the module
// graph; it needs a canvas jsdom does not have and nothing here calls it.
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({ promise: Promise.resolve(null) }),
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
		paintJpegXObject: 4,
	},
}));

const mcpPart: ComplexContentPartTool = {
	type: "tool",
	id: "call_1",
	name: "composio__COMPOSIO_MULTI_EXECUTE_TOOL",
	description: JSON.stringify({ data: { results: [{ successful: true }] } }),
	metadata: {
		tool: "composio__COMPOSIO_MULTI_EXECUTE_TOOL",
		tool_call_id: "call_1",
		tool_call: {
			id: "call_1",
			type: "function",
			function: {
				name: "composio__COMPOSIO_MULTI_EXECUTE_TOOL",
				arguments: '{"tool_slug":"GOOGLECALENDAR_EVENTS_LIST"}',
			},
		},
		tool_metadata: {
			source: "mcp",
			mcp: {
				serverName: "composio",
				originalToolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
			},
		},
		durationMs: 1_200,
		status: "completed",
	},
	state: "complete",
};

describe("AssistantToolTimelinePart", () => {
	it("names an MCP call by its server and tool instead of the prefixed slug", () => {
		render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		expect(
			screen.getByText("composio · COMPOSIO MULTI EXECUTE TOOL"),
		).toBeInTheDocument();
	});

	it("shows where an MCP result came from and what it was called with", () => {
		render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		expect(screen.getByText("MCP")).toBeInTheDocument();
		expect(screen.getByText("COMPOSIO_MULTI_EXECUTE_TOOL")).toBeInTheDocument();
		expect(
			screen.getByText(/GOOGLECALENDAR_EVENTS_LIST/, { selector: "pre" }),
		).toBeInTheDocument();
	});

	it("renders a JSON result as formatted code, not a run-on string", () => {
		const { container } = render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		const blocks = Array.from(container.querySelectorAll("pre"));
		const output = blocks.find((block) =>
			block.textContent?.includes('"successful"'),
		);
		expect(output).toBeDefined();
		// Pretty-printed, so the payload is readable rather than one long line.
		expect(output?.textContent).toContain("\n");
	});
});
