import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@/types/document-library";
import { DocumentTreeDraggable } from "../DocumentTreeDraggable";

const node = (partial: Partial<DocumentTreeNode>): DocumentTreeNode =>
	partial as unknown as DocumentTreeNode;

const tree: DocumentTreeNode[] = [
	node({
		id: "/notes",
		name: "notes",
		path: "/notes",
		type: "folder",
		isExpanded: false,
		children: [],
	}),
	node({
		id: "/home",
		name: "home",
		path: "/home",
		type: "folder",
		isExpanded: false,
		children: [],
	}),
	node({
		id: "/a.md",
		name: "a.md",
		path: "/a.md",
		type: "file",
		file: { type: "markdown" } as DocumentTreeNode["file"],
	}),
];

const openMenu = (name: string) =>
	fireEvent.contextMenu(screen.getByText(name));

describe("DocumentTreeDraggable's context menu", () => {
	it("downloads a folder, mapped or not, as a zip; a file has no zip", () => {
		const onDownloadFolder = vi.fn();
		const onUnmap = vi.fn();
		const view = render(
			<DocumentTreeDraggable
				tree={tree}
				selectedId={null}
				onSelectNode={vi.fn()}
				onRename={vi.fn()}
				onDelete={vi.fn()}
				onDownloadFolder={onDownloadFolder}
				mappedPaths={new Set(["/home"])}
				onUnmap={onUnmap}
			/>,
		);

		openMenu("notes");
		expect(screen.getByText("tree.rename")).toBeTruthy();
		fireEvent.click(screen.getByText("list.downloadZip"));
		expect(onDownloadFolder).toHaveBeenCalledWith(tree[0]);

		// A folder on the user's disk: zipping only reads it.
		openMenu("home");
		expect(screen.getByText("mappedFolders.unmap")).toBeTruthy();
		fireEvent.click(screen.getByText("list.downloadZip"));
		expect(onDownloadFolder).toHaveBeenLastCalledWith(tree[1]);

		openMenu("a.md");
		expect(screen.getByText("tree.rename")).toBeTruthy();
		expect(screen.queryByText("list.downloadZip")).toBeNull();
		view.unmount();
	});

	it("opens a menu for a folder that can only be downloaded", () => {
		const onDownloadFolder = vi.fn();
		render(
			<DocumentTreeDraggable
				tree={tree}
				selectedId={null}
				onSelectNode={vi.fn()}
				onDownloadFolder={onDownloadFolder}
			/>,
		);
		openMenu("notes");
		fireEvent.click(screen.getByText("list.downloadZip"));
		expect(onDownloadFolder).toHaveBeenCalledWith(tree[0]);
	});
});
