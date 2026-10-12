import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderIndexFeatureInfo } from "../FolderIndexFeatureInfo";

const mocks = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }));
vi.mock("@/services/folder-index/folder-index-client", () => ({
	folderIndexClient: { request: mocks.request },
}));
vi.mock("@/main/navigation/app-navigation", () => ({
	requestAppNavigation: mocks.navigate,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { folders?: string; count?: number }) =>
			options?.folders ? `${key}: ${options.folders}: ${options.count}` : key,
	}),
}));
beforeEach(() => {
	vi.clearAllMocks();
	mocks.request.mockResolvedValue({
		folders: [
			{
				path: "/Work",
				status: [
					{ typeId: "okf", entries: 3 },
					{ typeId: "embeddings", entries: 4, chunks: 20 },
				],
			},
			{ path: "/OnlyOKF", status: [{ typeId: "okf", entries: 2 }] },
			{
				path: "/OnlyEmbeddings",
				status: [{ typeId: "embeddings", entries: 8, chunks: 100 }],
			},
		],
	});
});
afterEach(cleanup);

describe("file index feature detail", () => {
	it("shows only OKF tools, folders and card counts", async () => {
		render(<FolderIndexFeatureInfo indexTypeId="okf" />);
		expect(screen.getByText("okf_index")).toBeInTheDocument();
		expect(screen.getByText("okf_read")).toBeInTheDocument();
		expect(screen.getByText("okf_search")).toBeInTheDocument();
		expect(screen.queryByText("embedding_search")).not.toBeInTheDocument();
		expect(
			await screen.findByText(
				"agentSettings.folderIndex.now: /Work, /OnlyOKF: 5",
			),
		).toBeInTheDocument();
	});
	it("shows only embedding tools and content chunk counts and links to Files", async () => {
		const onOpenFiles = vi.fn();
		render(
			<FolderIndexFeatureInfo
				indexTypeId="embeddings"
				onOpenFiles={onOpenFiles}
			/>,
		);
		expect(screen.getByText("embedding_search")).toBeInTheDocument();
		expect(screen.getByText("embedding_chunks")).toBeInTheDocument();
		expect(screen.queryByText("okf_read")).not.toBeInTheDocument();
		expect(
			await screen.findByText(
				"agentSettings.folderIndex.embeddingNow: /Work, /OnlyEmbeddings: 120",
			),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "agentSettings.folderIndex.open" }),
		);
		expect(onOpenFiles).toHaveBeenCalled();
		expect(mocks.navigate).toHaveBeenCalledWith({
			path: "/files",
			state: { openFolderIndexes: true },
		});
	});
});
