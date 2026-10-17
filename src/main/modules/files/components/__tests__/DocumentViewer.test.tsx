import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

/**
 * Opening a PDF, image or media file makes a blob URL for it. Each one used to
 * be kept for the life of the page — the cleanup looked at a URL that was
 * always still null — so browsing a folder of videos held all of them.
 */

const mocks = vi.hoisted(() => ({
	readFile: vi.fn(),
	actionRenders: vi.fn(),
	codeRenders: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/services", () => ({ serviceManager: {} }));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFile: mocks.readFile,
		onFilesystemChanged: () => () => {},
	},
}));
vi.mock("@/main/modules/topics/components", () => ({
	TopicBadgeList: () => null,
}));
vi.mock("@/main/stores/process-monitor", () => ({
	useIsProcessing: () => false,
}));
vi.mock("../../hooks/use-source-status", () => ({
	useSourceStatus: () => ({ isGenerating: false, status: null }),
}));
vi.mock("../../editors", () => ({
	editorRegistry: { getEditorComponent: () => null },
}));
vi.mock("../../editors/CodeEditor", () => ({
	CodeEditor: () => {
		mocks.codeRenders();
		return null;
	},
}));
vi.mock("../../folder-index", () => ({
	useFileIndexActions: () => {
		mocks.actionRenders();
		return { actions: [], dialogs: null };
	},
}));
vi.mock("../PDFPageSelector", () => ({ PDFPageSelector: () => null }));
vi.mock("../ExcelSheetSelector", () => ({ ExcelSheetSelector: () => null }));
vi.mock("../LazyExcelViewer", () => ({ LazyExcelViewer: () => null }));
vi.mock("../LazyPresentationViewer", () => ({
	LazyPresentationViewer: () => null,
}));

import { DocumentViewer } from "../DocumentViewer";

const fileOf = (name: string, type: DocumentFile["type"]): DocumentFile => ({
	id: `/${name}`,
	name,
	path: `/${name}`,
	type,
	mimeType: type === "pdf" ? "application/pdf" : "image/png",
	size: 3,
	createdAt: new Date(0),
	modifiedAt: new Date(0),
});
const pdf = fileOf("report.pdf", "pdf");
const notes = { ...fileOf("notes.md", "text"), mimeType: "text/markdown" };
const image = fileOf("photo.png", "image");
const topics: never[] = [];

let urls = 0;
const createObjectURL = vi.fn(() => `blob:${++urls}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
	urls = 0;
	mocks.readFile.mockReset();
	mocks.actionRenders.mockReset();
	mocks.codeRenders.mockReset();
	createObjectURL.mockClear();
	revokeObjectURL.mockClear();
	vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("DocumentViewer previews", () => {
	it("releases each file's URL when another file opens and when it closes", async () => {
		mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		const view = render(<DocumentViewer file={pdf} fileTopics={topics} />);
		await act(async () => {});
		expect(createObjectURL).toHaveBeenCalledTimes(1);

		view.rerender(<DocumentViewer file={image} fileTopics={topics} />);
		await act(async () => {});
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:1");
		expect(createObjectURL).toHaveBeenCalledTimes(2);

		view.unmount();
		expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:2");
	});

	it("drops a slow read when another file was opened meanwhile", async () => {
		let finish!: (bytes: Uint8Array) => void;
		mocks.readFile
			.mockReturnValueOnce(
				new Promise<Uint8Array>((resolve) => {
					finish = resolve;
				}),
			)
			.mockResolvedValue(new Uint8Array([4]));
		const view = render(<DocumentViewer file={pdf} fileTopics={topics} />);
		view.rerender(<DocumentViewer file={image} fileTopics={topics} />);
		await act(async () => {});
		await act(async () => {
			finish(new Uint8Array([1]));
		});

		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
			"blob:1",
		);
	});

	it("clears the loading state when a file is left before it loads", async () => {
		mocks.readFile
			.mockReturnValueOnce(new Promise<Uint8Array>(() => undefined))
			.mockResolvedValue(new TextEncoder().encode("# Notes"));
		const view = render(<DocumentViewer file={pdf} fileTopics={topics} />);
		await act(async () => {});
		expect(view.queryByText("viewer.loadingPreview")).not.toBeNull();

		view.rerender(<DocumentViewer file={notes} fileTopics={topics} />);
		await act(async () => {});

		expect(view.queryByText("viewer.loadingPreview")).toBeNull();
	});

	it("does not redraw when its parent redraws with the same props", async () => {
		mocks.readFile.mockResolvedValue(new Uint8Array([1]));
		const onClose = vi.fn();
		const view = render(
			<DocumentViewer file={pdf} fileTopics={topics} onClose={onClose} />,
		);
		await act(async () => {});
		const renders = mocks.actionRenders.mock.calls.length;
		view.rerender(
			<DocumentViewer file={pdf} fileTopics={topics} onClose={onClose} />,
		);
		expect(mocks.actionRenders).toHaveBeenCalledTimes(renders);
	});
});

describe("DocumentViewer and files that are not text", () => {
	it("shows a note for a zip, not its bytes as code", async () => {
		mocks.readFile.mockResolvedValue(
			new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
		);
		const view = render(
			<DocumentViewer file={fileOf("docs.zip", "other")} fileTopics={topics} />,
		);
		await act(async () => {});
		expect(view.getByText("viewer.zipNoPreview")).toBeTruthy();
		expect(mocks.codeRenders).not.toHaveBeenCalled();
	});

	it("still opens an unknown file that is text", async () => {
		mocks.readFile.mockResolvedValue(new TextEncoder().encode("key = value"));
		const view = render(
			<DocumentViewer file={fileOf("app.conf", "other")} fileTopics={topics} />,
		);
		await act(async () => {});
		expect(view.queryByText("viewer.binaryNoPreview")).toBeNull();
		expect(mocks.codeRenders).toHaveBeenCalled();
	});
});
