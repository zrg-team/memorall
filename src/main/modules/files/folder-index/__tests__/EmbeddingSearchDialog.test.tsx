import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	cleanup,
} from "@testing-library/react";
import { EmbeddingSearchDialog } from "../EmbeddingSearchDialog";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	readFile: vi.fn(),
	resolveNode: vi.fn(),
}));
vi.mock("@/services/folder-index/folder-index-client", () => ({
	folderIndexClient: { request: mocks.request },
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFile: mocks.readFile,
		resolveNode: mocks.resolveNode,
	},
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("semantic file search", () => {
	it("searches indexed content in the current folder and opens the matching source", async () => {
		mocks.request.mockResolvedValue({
			hits: [
				{
					id: "/Music/notes.md#1",
					path: "/Music/notes.md",
					title: "notes.md",
					kind: "text",
					location: { startChar: 1800, endChar: 2000 },
					text: "A piano performance.",
					score: 0.84,
				},
			],
			searched: 8,
			truncated: false,
		});
		const onOpenFile = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<EmbeddingSearchDialog
				open
				onOpenChange={onOpenChange}
				folderPath="/Music"
				onOpenFile={onOpenFile}
			/>,
		);
		fireEvent.change(screen.getByLabelText("folderIndex.embedding.query"), {
			target: { value: "piano" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "folderIndex.embedding.search" }),
		);
		await waitFor(() =>
			expect(mocks.request).toHaveBeenCalledWith("embedding.search", {
				query: "piano",
				folder: "/Music",
				limit: 20,
			}),
		);
		expect(await screen.findByText("0.840")).toHaveAttribute(
			"title",
			"folderIndex.embedding.cosine",
		);
		expect(screen.getAllByText("Characters 1801–2000").length).toBeGreaterThan(
			0,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "folderIndex.embedding.openFile" }),
		);
		expect(onOpenFile).toHaveBeenCalledWith("/Music/notes.md");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
	it("shows native media chunks and their timestamps without a transcript", async () => {
		mocks.request.mockResolvedValue([
			{
				id: "/Music/piano.mp3#0",
				path: "/Music/piano.mp3",
				title: "piano.mp3",
				kind: "audio",
				location: { startSeconds: 28, endSeconds: 58 },
			},
		]);
		mocks.readFile.mockRejectedValue(new Error("Preview unavailable"));
		render(
			<EmbeddingSearchDialog
				open
				onOpenChange={() => {}}
				folderPath="/Music"
				filePath="/Music/piano.mp3"
			/>,
		);
		await waitFor(() =>
			expect(mocks.request).toHaveBeenCalledWith("embedding.chunks", {
				path: "/Music/piano.mp3",
			}),
		);
		expect((await screen.findAllByText(/0:28–0:58/)).length).toBe(2);
		expect(await screen.findByText("Preview unavailable")).toBeInTheDocument();
		expect(screen.queryByText(/transcript/i)).not.toBeInTheDocument();
	});
});
