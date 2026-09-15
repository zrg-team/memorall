import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
	initialize: vi.fn(async () => undefined),
	getTree: vi.fn(async () => [
		{ type: "folder", path: "/Pictures", name: "Pictures", children: [] },
	]),
	uploadFile: vi.fn(async (_file: File, _folder: string) => ({})),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: string | { defaultValue?: string }) =>
			typeof options === "string" ? options : (options?.defaultValue ?? key),
	}),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: fs,
}));

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

import { SaveToFilesAction } from "../SaveToFilesAction";

describe("SaveToFilesAction", () => {
	beforeEach(() => {
		fs.uploadFile.mockClear();
	});

	it("stores a generation's bytes in Files, loading them only on save", async () => {
		const user = userEvent.setup();
		const bytes = new Uint8Array([137, 80, 78, 71]);
		const load = vi.fn(async () => bytes);

		render(
			<SaveToFilesAction
				fileName="red-fox.png"
				mimeType="image/png"
				content={load}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Save to Files" }));
		expect(load).not.toHaveBeenCalled();
		expect(await screen.findByDisplayValue("red-fox.png")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Save to documents" }));

		await waitFor(() => expect(fs.uploadFile).toHaveBeenCalledTimes(1));
		expect(load).toHaveBeenCalledTimes(1);
		const [file, folder] = fs.uploadFile.mock.calls[0] ?? [];
		expect(folder).toBe("/");
		expect(file?.name).toBe("red-fox.png");
		expect(file?.type).toBe("image/png");
		expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(bytes);
		expect(
			await screen.findByRole("button", { name: "Saved" }),
		).toBeInTheDocument();
	});
});
