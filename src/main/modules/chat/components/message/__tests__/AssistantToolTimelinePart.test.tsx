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

/** A tool served over MCP that is not Composio's, to prove the split. */
const genericMcpPart: ComplexContentPartTool = {
	...mcpPart,
	name: "filesystem__read_file",
	metadata: {
		...mcpPart.metadata,
		tool_metadata: {
			source: "mcp",
			mcp: { serverName: "filesystem", originalToolName: "read_file" },
		},
	},
};

describe("AssistantToolTimelinePart", () => {
	it("names a Composio call by the app it touched, not the router slug", () => {
		render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		// COMPOSIO_MULTI_EXECUTE_TOOL is a router meta-tool; the call it stands
		// in for is what the user cares about.
		expect(
			screen.getByText("Google Calendar · Events list"),
		).toBeInTheDocument();
	});

	it("shows the app, the action and the slug behind a Composio result", () => {
		render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		expect(screen.getAllByText("Google Calendar").length).toBeGreaterThan(0);
		expect(
			screen.getAllByText("GOOGLECALENDAR_EVENTS_LIST").length,
		).toBeGreaterThan(0);
	});

	it("still exposes the untouched payload behind the Raw toggle", () => {
		render(
			<AssistantToolTimelinePart
				part={mcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		expect(screen.getByText("Raw")).toBeInTheDocument();
		expect(screen.getByText("Input")).toBeInTheDocument();
		expect(screen.getByText("Output")).toBeInTheDocument();
	});

	it("leaves non-Composio MCP tools on the generic renderer", () => {
		render(
			<AssistantToolTimelinePart
				part={genericMcpPart}
				isLast={true}
				forceOpen={true}
			/>,
		);

		expect(screen.getByText("MCP")).toBeInTheDocument();
		expect(screen.getByText("filesystem · Read file")).toBeInTheDocument();
	});
});
