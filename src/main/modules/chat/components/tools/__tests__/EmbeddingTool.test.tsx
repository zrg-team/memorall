import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingToolDetails } from "../EmbeddingTool";
import { parseEmbeddingToolOutput } from "../embedding-tool-output";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	readFile: vi.fn(async () => {
		throw new Error("Unavailable");
	}),
}));
vi.mock("@/main/navigation/app-navigation", () => ({
	requestAppNavigation: mocks.navigate,
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFile: mocks.readFile },
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
const hit = (path: string, kind = "image", score = 0.716) => ({
	id: `${path}#0`,
	path,
	title: path.split("/").at(-1),
	kind,
	location: {},
	score,
});
const payload = {
	actionType: "embedding_search",
	query: "nón lá",
	matched: 3,
	searched: 1434,
	truncated: false,
	hits: [
		hit("/game/portraits.webp"),
		hit("/game/portraits.webp", "image", 0.701),
		{ ...hit("/game/notes.md", "text"), text: "Conical hat research." },
	],
	previewPaths: ["/game/portraits.webp"],
};

describe("embedding search result cards", () => {
	it("shows thumbnails, grouped source files, snippets and an action to open the actual file", () => {
		const content = [
			{ type: "text", text: JSON.stringify(payload) },
			{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
		];
		render(
			<EmbeddingToolDetails
				item={{
					name: "embedding_search",
					description: JSON.stringify(content),
				}}
			/>,
		);
		expect(screen.getByRole("img", { name: "portraits.webp" })).toHaveAttribute(
			"src",
			"data:image/png;base64,AAA",
		);
		expect(screen.getAllByText("portraits.webp")).toHaveLength(1);
		expect(screen.getByText("Conical hat research.")).toBeInTheDocument();
		expect(screen.getAllByText(/0.716/)).toHaveLength(2);
		expect(screen.getByText("embeddingTool.locations")).toBeInTheDocument();
		fireEvent.click(
			screen.getAllByRole("button", { name: "embeddingTool.open" })[0],
		);
		expect(mocks.navigate).toHaveBeenCalledWith({
			path: "/files",
			state: { openDocumentPath: "/game/portraits.webp" },
		});
		expect(mocks.readFile).not.toHaveBeenCalled();
	});
	it("keeps existing prose search results readable", () => {
		const description =
			"1 matches from 1434 chunks:\n\n/game/portraits.webp\n  image · Whole image · cosine 0.716\n  Chunk: /game/portraits.webp#0";
		expect(parseEmbeddingToolOutput(description)?.hits[0]).toMatchObject({
			path: "/game/portraits.webp",
			score: 0.716,
			locationLabel: "Whole image",
		});
		render(
			<EmbeddingToolDetails item={{ name: "embedding_search", description }} />,
		);
		expect(screen.getByText("portraits.webp")).toBeInTheDocument();
	});
	it("keeps the source card usable when its saved preview fails to load", () => {
		render(
			<EmbeddingToolDetails
				item={{
					name: "embedding_search",
					description: JSON.stringify(payload),
					metadata: { imageUrls: ["data:image/png;base64,AAA"] },
				}}
			/>,
		);
		fireEvent.error(screen.getByRole("img", { name: "portraits.webp" }));
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		fireEvent.click(
			screen.getAllByRole("button", { name: "embeddingTool.open" })[0],
		);
		expect(mocks.navigate).toHaveBeenCalledWith({
			path: "/files",
			state: { openDocumentPath: "/game/portraits.webp" },
		});
	});
	it("shows empty results and preserves readable failures", () => {
		const { rerender } = render(
			<EmbeddingToolDetails
				item={{
					name: "embedding_search",
					description: JSON.stringify({
						...payload,
						hits: [],
						matched: 0,
						previewPaths: [],
					}),
				}}
			/>,
		);
		expect(screen.getByText("embeddingTool.empty")).toBeInTheDocument();
		rerender(
			<EmbeddingToolDetails
				item={{
					name: "embedding_search",
					description: "No folder has an Embeddings index.",
				}}
			/>,
		);
		expect(
			screen.getByText("No folder has an Embeddings index."),
		).toBeInTheDocument();
	});
	it("collapses long result sets until the user chooses to see more", () => {
		const result = {
			...payload,
			hits: Array.from({ length: 8 }, (_, i) => hit(`/game/${i}.md`, "text")),
			matched: 8,
			previewPaths: [],
		};
		render(
			<EmbeddingToolDetails
				item={{ name: "embedding_search", description: JSON.stringify(result) }}
			/>,
		);
		expect(screen.queryByText("7.md")).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "embeddingTool.showAll" }),
		);
		expect(screen.getByText("7.md")).toBeInTheDocument();
	});
});
