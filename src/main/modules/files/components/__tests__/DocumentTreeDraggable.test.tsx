import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentTreeNode } from "@/types/document-library";
import { DocumentTreeDraggable } from "../DocumentTreeDraggable";

// The tree's folder-index badges reach the native-mounts hook, and with it
// the library filesystem, which configures ZenFS (IndexedDB) on import.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {},
}));

// Every row asks for its drag handle once per render: a cheap render count.
const drawn = vi.hoisted(() => [] as string[]);
vi.mock("@dnd-kit/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dnd-kit/core")>();
	return {
		...actual,
		useDraggable: (args: Parameters<typeof actual.useDraggable>[0]) => {
			drawn.push(String(args.id));
			return actual.useDraggable(args);
		},
	};
});

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

describe("DocumentTreeDraggable's rows", () => {
	const folder = (path: string, children: DocumentTreeNode[]) =>
		node({
			id: path,
			name: path.split("/").at(-1),
			path,
			type: "folder",
			isExpanded: true,
			children,
		});
	const file = (path: string) =>
		node({
			id: path,
			name: path.split("/").at(-1),
			path,
			type: "file",
			file: { type: "markdown" } as DocumentTreeNode["file"],
		});
	const big = [
		folder("/A", [file("/A/a1.md"), file("/A/a2.md")]),
		folder("/B", [file("/B/b1.md")]),
		file("/c.md"),
	];
	const handlers = { onSelectNode: vi.fn(), onToggleExpand: vi.fn() };

	it("redraws only the rows on the way to the old and new selection", () => {
		const view = render(
			<DocumentTreeDraggable tree={big} selectedId={null} {...handlers} />,
		);
		drawn.length = 0;
		view.rerender(
			<DocumentTreeDraggable tree={big} selectedId={null} {...handlers} />,
		);
		expect(drawn).toEqual([]);
		view.rerender(
			<DocumentTreeDraggable tree={big} selectedId="/A/a1.md" {...handlers} />,
		);
		expect(drawn.sort()).toEqual(["/A", "/A/a1.md"]);

		drawn.length = 0;
		view.rerender(
			<DocumentTreeDraggable tree={big} selectedId="/A/a1.md" {...handlers} />,
		);
		expect(drawn).toEqual([]);

		drawn.length = 0;
		view.rerender(
			<DocumentTreeDraggable tree={big} selectedId="/B/b1.md" {...handlers} />,
		);
		expect(drawn.sort()).toEqual(["/A", "/A/a1.md", "/B", "/B/b1.md"]);
		expect(screen.getByText("b1.md").closest("[style]")?.className).toContain(
			"bg-accent",
		);
		view.unmount();
	});
});
