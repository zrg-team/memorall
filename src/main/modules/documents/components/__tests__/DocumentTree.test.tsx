import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@/types/document-library";

import { DocumentTree } from "../DocumentTree";

const node = (partial: Partial<DocumentTreeNode>): DocumentTreeNode =>
	partial as unknown as DocumentTreeNode;

const makeTree = (isExpanded: boolean): DocumentTreeNode[] => [
	node({
		id: "folder-1",
		name: "Folder One",
		type: "folder",
		isExpanded,
		children: [
			node({
				id: "doc-1",
				name: "Nested Doc",
				type: "file",
				file: { type: "markdown" } as DocumentTreeNode["file"],
			}),
		],
	}),
	node({
		id: "doc-2",
		name: "Root Doc",
		type: "file",
		file: { type: "pdf" } as DocumentTreeNode["file"],
	}),
];

describe("DocumentTree", () => {
	it("renders folders, root files, and expanded children", () => {
		render(
			<DocumentTree
				tree={makeTree(true)}
				selectedId={null}
				onSelectNode={vi.fn()}
				onToggleExpand={vi.fn()}
			/>,
		);

		expect(screen.getByText("Folder One")).toBeInTheDocument();
		expect(screen.getByText("Root Doc")).toBeInTheDocument();
		expect(screen.getByText("Nested Doc")).toBeInTheDocument();
	});

	it("hides children when the folder is collapsed", () => {
		render(
			<DocumentTree
				tree={makeTree(false)}
				selectedId={null}
				onSelectNode={vi.fn()}
				onToggleExpand={vi.fn()}
			/>,
		);

		expect(screen.queryByText("Nested Doc")).not.toBeInTheDocument();
	});

	it("calls onSelectNode when a row is clicked", () => {
		const onSelectNode = vi.fn();
		render(
			<DocumentTree
				tree={makeTree(true)}
				selectedId={null}
				onSelectNode={onSelectNode}
				onToggleExpand={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByText("Root Doc"));
		expect(onSelectNode).toHaveBeenCalledWith(
			expect.objectContaining({ id: "doc-2" }),
		);
	});

	it("toggles expansion without selecting when the chevron is clicked", () => {
		const onSelectNode = vi.fn();
		const onToggleExpand = vi.fn();
		render(
			<DocumentTree
				tree={makeTree(true)}
				selectedId={null}
				onSelectNode={onSelectNode}
				onToggleExpand={onToggleExpand}
			/>,
		);

		// The only button rendered is the folder's expand/collapse chevron.
		fireEvent.click(screen.getByRole("button"));
		expect(onToggleExpand).toHaveBeenCalledWith(
			expect.objectContaining({ id: "folder-1" }),
		);
		expect(onSelectNode).not.toHaveBeenCalled();
	});
});
