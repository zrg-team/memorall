import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFileAsBase64: vi.fn(async () => ""),
	},
}));

import { memoryToolRenderer } from "../tools/MemoryTool";

const FACT = [
	"id: 78ea91c3-53c8-43cc-9eb0-0c75be566969",
	"kind: project_context",
	"source: active_memory",
	"status: current",
	"fact: The user re-sent the Batdongsan URL pr46112113.",
	"relation: Batdongsan listing 46112113 -[noted_in]-> Session note",
].join("\n");

const item = (description: string, args?: Record<string, unknown>) => ({
	name: "memory_retrieve",
	description,
	metadata: args
		? {
				tool_call: {
					function: { arguments: JSON.stringify(args) },
				},
			}
		: undefined,
});

describe("memoryToolRenderer", () => {
	it("renders nothing until the row is expanded", () => {
		expect(memoryToolRenderer(item(FACT), false)).toBeNull();
	});

	it("leads with the fact, not the id", () => {
		const { container } = render(<>{memoryToolRenderer(item(FACT), true)}</>);

		expect(
			screen.getByText("The user re-sent the Batdongsan URL pr46112113."),
		).toBeTruthy();
		// The id stays reachable for memory_update/memory_remove, just demoted.
		const id = screen.getByText("78ea91c3-53c8-43cc-9eb0-0c75be566969");
		expect(id.className).toContain("text-[10px]");
		expect(container.textContent).not.toContain("id: 78ea91c3");
	});

	it("splits the relation into subject, predicate and object", () => {
		render(<>{memoryToolRenderer(item(FACT), true)}</>);

		expect(screen.getByText("Batdongsan listing 46112113")).toBeTruthy();
		expect(screen.getByText("noted_in")).toBeTruthy();
		expect(screen.getByText("Session note")).toBeTruthy();
	});

	it("numbers every memory in a multi-result retrieval", () => {
		render(
			<>
				{memoryToolRenderer(item([FACT, FACT, FACT].join("\n\n---\n\n")), true)}
			</>,
		);

		expect(screen.getByText("3 memories")).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
	});

	it("shows the query that was searched for", () => {
		render(
			<>{memoryToolRenderer(item(FACT, { query: "batdongsan" }), true)}</>,
		);

		const detail = screen.getByText("Query").parentElement as HTMLElement;
		expect(within(detail).getByText("batdongsan")).toBeTruthy();
	});

	it("states an empty result as a sentence rather than a blank card", () => {
		render(
			<>{memoryToolRenderer(item("No matching memories found."), true)}</>,
		);

		expect(screen.getByText("No matching memories found.")).toBeTruthy();
	});
});
