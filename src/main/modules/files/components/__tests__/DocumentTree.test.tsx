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

	/**
	 * A mapped folder arrives with no children so the library can draw before
	 * the OS has been walked. Everything below keys off `isLazy`, and getting it
	 * wrong is silent: the row renders, it just cannot be opened.
	 */
	describe("folders whose contents are not read yet", () => {
		const lazyFolder = (extra: Partial<DocumentTreeNode> = {}) => [
			node({
				id: "/Photos",
				name: "Photos",
				path: "/Photos",
				type: "folder",
				isExpanded: false,
				children: [],
				isLazy: true,
				...extra,
			}),
		];

		it("can still be opened even though it has no children", () => {
			const onToggleExpand = vi.fn();
			render(
				<DocumentTree
					tree={lazyFolder()}
					selectedId={null}
					onSelectNode={vi.fn()}
					onToggleExpand={onToggleExpand}
				/>,
			);

			const row = screen.getByText("Photos").closest("div");
			const toggle = row?.querySelector("button");
			expect(toggle).not.toBeNull();
			fireEvent.click(toggle as Element);
			expect(onToggleExpand).toHaveBeenCalledTimes(1);
		});

		it("shows the folder is being read rather than looking empty", () => {
			const { container } = render(
				<DocumentTree
					tree={lazyFolder({ isExpanded: true, isLoading: true })}
					selectedId={null}
					onSelectNode={vi.fn()}
					onToggleExpand={vi.fn()}
				/>,
			);

			expect(container.querySelector(".animate-spin")).not.toBeNull();
		});

		it("does not mark an ordinary folder", () => {
			render(
				<DocumentTree
					tree={lazyFolder()}
					selectedId={null}
					onSelectNode={vi.fn()}
					onToggleExpand={vi.fn()}
				/>,
			);

			expect(screen.queryByText("mappedFolders.badge")).toBeNull();
		});

		it("marks a mapped root so it is not mistaken for a library folder", () => {
			render(
				<DocumentTree
					tree={lazyFolder()}
					selectedId={null}
					onSelectNode={vi.fn()}
					onToggleExpand={vi.fn()}
					mappedPaths={new Set(["/Photos"])}
				/>,
			);

			// The badge is the visible difference; the amber icon alone was too
			// quiet to say "edits here land on your real disk".
			expect(screen.getByText("mappedFolders.badge")).toBeInTheDocument();
		});
	});
});
