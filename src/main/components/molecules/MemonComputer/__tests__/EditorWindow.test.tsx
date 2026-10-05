import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonEditorState } from "@/services/memon/types";

// The previews pull in the document filesystem and markdown renderer.
vi.mock("@/platform/current", () => ({
	platform: {
		assets: { sandboxPageUrl: (page: string) => `/extension/${page}` },
	},
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {},
}));
vi.mock("@/main/modules/chat/components/message/MarkdownMessageBody", () => ({
	MarkdownMessageBody: () => null,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { EditorWindow } from "../windows/EditorWindow";

const editorState = (
	overrides: Partial<MemonEditorState> = {},
): MemonEditorState => ({
	path: "/notes/a.txt",
	content: "hello",
	saved: true,
	screenLine: 0,
	...overrides,
});

const renderWindow = (state: MemonEditorState) => {
	const send = vi.fn(async () => undefined);
	const view = render(
		<EditorWindow machineKey="a1" editor={state} send={send as never} />,
	);
	const update = (next: MemonEditorState) =>
		view.rerender(
			<EditorWindow machineKey="a1" editor={next} send={send as never} />,
		);
	return { send, update };
};

describe("EditorWindow", () => {
	it("saves a draft with the text it started from", () => {
		const { send } = renderWindow(editorState());
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "hello there" },
		});
		fireEvent.click(screen.getByRole("button", { name: /save/i }));
		expect(send).toHaveBeenCalledWith("editor.save", {
			key: "a1",
			content: "hello there",
			base: "hello",
		});
	});

	it("warns when the agent changes the file under a draft, and saves over it only on request", async () => {
		const { send, update } = renderWindow(editorState());
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "hello there" },
		});
		expect(screen.queryByRole("alert")).toBeNull();

		update(editorState({ content: "from the agent" }));

		expect(screen.getByRole("alert")).toBeInTheDocument();
		expect(screen.getByRole("textbox")).toHaveValue("hello there");
		fireEvent.click(screen.getByRole("button", { name: /keep ?mine/i }));
		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("editor.save", {
				key: "a1",
				content: "hello there",
				overwrite: true,
			}),
		);
	});

	it("reloads the file when it changed on disk under unsaved edits", () => {
		const { send } = renderWindow(
			editorState({ saved: false, content: "mine", conflict: "on disk" }),
		);
		fireEvent.click(screen.getByRole("button", { name: /reload/i }));
		expect(send).toHaveBeenCalledWith("editor.reload", { key: "a1" });
	});
});
