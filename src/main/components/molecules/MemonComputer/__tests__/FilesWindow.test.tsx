import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonFilesState } from "@/services/memon/types";
import {
	contextMenuActions,
	type MemonMenuAction,
} from "../context-menu-actions";
import { FilesWindow } from "../windows/FilesWindow";

vi.mock("../upload", () => ({
	pickFiles: vi.fn(),
	uploadToComputer: vi.fn(),
}));
vi.mock("@/main/modules/files/utils/save-download", () => ({
	downloadFolderAsZip: vi.fn(),
}));

const files: MemonFilesState = {
	cwd: "/work",
	entries: [
		{ name: "docs", path: "/work/docs", type: "dir" },
		{ name: "a.md", path: "/work/a.md", type: "file", size: 10 },
		{ name: "b.md", path: "/work/b.md", type: "file", size: 20 },
	],
	clipboard: { mode: "copy", paths: ["/elsewhere/c.md"] },
};

/** Files, with what each right-click would offer recorded. */
const setup = () => {
	const send = vi.fn(async () => undefined);
	const menus: MemonMenuAction[][] = [];
	render(
		// biome-ignore lint/a11y/noStaticElementInteractions: stands in for the desktop's menu.
		<div onContextMenu={(event) => menus.push(contextMenuActions(event))}>
			<FilesWindow
				machineKey="k"
				files={files}
				home="/agents/guest"
				send={send}
			/>
		</div>,
	);
	const row = (name: string) => {
		const button = screen.getByText(name).closest("button");
		if (!button) throw new Error(`${name} is not a row`);
		return button;
	};
	const labels = () => menus.at(-1)?.map((action) => action.label);
	const run = (label: string) =>
		menus
			.at(-1)
			?.find((action) => action.label === label)
			?.run();
	return { send, row, labels, run };
};

describe("FilesWindow", () => {
	it("selects on one click and opens on two, or with Enter", () => {
		const { send, row } = setup();
		fireEvent.click(row("a.md"));
		expect(row("a.md")).toHaveAttribute("aria-pressed", "true");
		expect(send).not.toHaveBeenCalled();

		fireEvent.doubleClick(row("a.md"));
		expect(send).toHaveBeenLastCalledWith("files.ref", {
			key: "k",
			ref: row("a.md").dataset.memonRef,
		});
		fireEvent.keyDown(row("b.md"), { key: "Enter" });
		expect(send).toHaveBeenLastCalledWith("files.ref", {
			key: "k",
			ref: row("b.md").dataset.memonRef,
		});
	});

	it("offers open, cut, copy, paste and delete on a right-click", () => {
		const { send, row, labels, run } = setup();
		fireEvent.contextMenu(row("docs/"));
		expect(labels()).toEqual([
			"memonComputer.files.open",
			"memonComputer.files.cut",
			"memonComputer.files.copy",
			"memonComputer.files.pasteInto",
			"buttons.delete",
		]);
		run("memonComputer.files.pasteInto");
		expect(send).toHaveBeenLastCalledWith("files.paste", {
			key: "k",
			to: "/work/docs",
		});

		// A right-click inside the selection acts on all of it.
		fireEvent.click(row("a.md"));
		fireEvent.click(row("b.md"), { ctrlKey: true });
		fireEvent.contextMenu(row("b.md"));
		expect(labels()).not.toContain("memonComputer.files.pasteInto");
		run("memonComputer.files.cut");
		expect(send).toHaveBeenLastCalledWith("files.clipboard", {
			key: "k",
			mode: "cut",
			paths: ["/work/a.md", "/work/b.md"],
		});

		// Empty space pastes into the open folder.
		fireEvent.contextMenu(
			screen.getByText("memonComputer.dropHint", { exact: false }),
		);
		expect(labels()).toEqual(["memonComputer.files.paste"]);
		run("memonComputer.files.paste");
		expect(send).toHaveBeenLastCalledWith("files.paste", { key: "k" });
	});

	it("deletes only once the user confirms", () => {
		const { send, row } = setup();
		fireEvent.click(row("a.md"));
		fireEvent.keyDown(row("a.md"), { key: "Delete" });
		const dialog = screen.getByRole("alertdialog");
		expect(
			within(dialog).getByText("memonComputer.files.deleteOne"),
		).toBeInTheDocument();
		expect(send).not.toHaveBeenCalled();

		fireEvent.click(
			within(dialog).getByRole("button", { name: "buttons.delete" }),
		);
		expect(send).toHaveBeenCalledWith("files.delete", {
			key: "k",
			paths: ["/work/a.md"],
		});
	});
});
