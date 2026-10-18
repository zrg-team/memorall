import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/main/i18n/locales/en/studio.json";
import type { StudioItem } from "@/types/studio";
import { StudioModelPickerContext } from "../../shared/studio-model-picker";
import { OCRStudio } from "../OCRStudio";
import { OCRPreview } from "../OCRPreview";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values: Record<string, unknown> = {}) => {
			const value =
				key.split(".").reduce((value: any, part) => value?.[part], en) ?? key;
			return String(value).replace(/\{\{(\w+)\}\}/g, (_, name) =>
				String(values[name] ?? name),
			);
		},
	}),
}));
const mocks = vi.hoisted(() => ({
	open: vi.fn(),
	renderPage: vi.fn(),
	close: vi.fn(),
	save: vi.fn(),
	extract: vi.fn(),
	session: { currentConversationId: "session-1" },
}));
vi.mock("@/main/stores/studio", () => ({
	useStudioStore: { getState: () => ({ modes: { ocr: mocks.session } }) },
}));
vi.mock("../ocr-document", async (original) => ({
	...(await original<typeof import("../ocr-document")>()),
	openOCRDocument: mocks.open,
}));
vi.mock("../../../services/studio-service", () => ({
	saveStudioInput: mocks.save,
	extractOCR: mocks.extract,
	isCancellation: (error: Error) => error.name === "AbortError",
}));
vi.mock("../../shared/StoredImage", () => ({
	StoredImage: ({ path, alt }: { path: string; alt: string }) => (
		<img src={path} alt={alt} />
	),
}));
vi.mock("../../shared/SaveToFilesAction", () => ({
	SaveToFilesAction: ({
		fileName,
		mimeType,
		content,
	}: {
		fileName: string;
		mimeType: string;
		content: string;
	}) => (
		<button
			type="button"
			data-file-name={fileName}
			data-mime-type={mimeType}
			data-content={content}
		>
			Save to Files
		</button>
	),
}));

const model = {
	modelId: "org/vision-ocr",
	provider: "custom" as const,
	serviceName: "custom",
};
const item: StudioItem = {
	id: "item-1",
	conversationId: "session-1",
	category: "ocr",
	content: "report.pdf",
	createdAt: new Date(),
	parts: [
		{
			type: "image",
			image: { path: "inputs/page.png", mimeType: "image/png", role: "input" },
		},
		{
			type: "text",
			text: "![title](10,10,900,100)\n# Report",
			role: "transcript",
		},
	],
	generation: {
		category: "ocr",
		...model,
		status: "done",
		params: { pageNumber: 1 },
	},
};
function setup(items: StudioItem[] = []) {
	const ready = vi.fn(async () => model);
	const props = {
		mode: "ocr" as const,
		model,
		items,
		ensureModelReady: ready,
		isNarrow: false,
	};
	const ui = (next = props) => (
		<StudioModelPickerContext.Provider
			value={<button type="button">Choose OCR model</button>}
		>
			<OCRStudio {...next} />
		</StudioModelPickerContext.Provider>
	);
	const result = render(ui());
	return { ...result, ready, props, ui };
}
async function upload() {
	const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
	fireEvent.change(input, {
		target: {
			files: [new File(["pdf"], "report.pdf", { type: "application/pdf" })],
		},
	});
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Extract text" })).toBeEnabled(),
	);
}

describe("OCR workspace", () => {
	it("offers model instructions for any compatible on-device model", () => {
		render(
			<OCRStudio
				mode="ocr"
				model={{
					modelId: "org/future-ocr-ONNX",
					provider: "transformer-media",
					serviceName: "transformer-media",
				}}
				items={[]}
				ensureModelReady={vi.fn()}
				isNarrow={false}
			/>,
		);
		expect(screen.getByText(/Runs on this device/)).toBeVisible();
		expect(
			screen.getByRole("checkbox", { name: "Include layout boxes" }),
		).toBeEnabled();
	});
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mocks.session.currentConversationId = "session-1";
		URL.createObjectURL = vi.fn(() => "blob:preview");
		URL.revokeObjectURL = vi.fn();
		mocks.renderPage.mockResolvedValue(
			new Blob(["image"], { type: "image/png" }),
		);
		mocks.open.mockResolvedValue({
			name: "report.pdf",
			pageCount: 3,
			renderPage: mocks.renderPage,
			close: mocks.close,
		});
		mocks.save.mockResolvedValue({
			kind: "file",
			path: "inputs/page.png",
			mimeType: "image/png",
		});
		mocks.extract.mockResolvedValue(item);
	});
	it("keeps model selection visible and extracts a selected PDF page with that model", async () => {
		const { ready } = setup();
		expect(
			screen.getByRole("button", { name: "Choose OCR model" }),
		).toBeVisible();
		await upload();
		await userEvent.click(screen.getByRole("button", { name: "Next page" }));
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Extract text" }),
			).toBeEnabled(),
		);
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() =>
			expect(mocks.extract).toHaveBeenCalledWith(
				expect.objectContaining({
					model,
					fileName: "report.pdf",
					pageNumber: 2,
					grounding: false,
				}),
			),
		);
		expect(ready).toHaveBeenCalledOnce();
		expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.extract.mock.invocationCallOrder[0]!,
		);
	});
	it("processes every PDF page in order when requested", async () => {
		setup();
		await upload();
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Pages to convert" }),
			"all",
		);
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Include layout boxes" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(3));
		expect(
			mocks.extract.mock.calls.map(([request]) => request.pageNumber),
		).toEqual([1, 2, 3]);
		expect(
			mocks.extract.mock.calls.every(([request]) => request.grounding),
		).toBe(true);
	});
	it("stops a request and does not send remaining pages", async () => {
		mocks.extract.mockImplementation(
			({ signal }: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("Stopped", "AbortError")),
						{ once: true },
					),
				),
		);
		setup();
		await upload();
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Pages to convert" }),
			"all",
		);
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() => expect(mocks.extract).toHaveBeenCalledOnce());
		await userEvent.click(screen.getByRole("button", { name: "Stop" }));
		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent("Extraction stopped"),
		);
		expect(mocks.extract.mock.calls[0]![0].signal.aborted).toBe(true);
		expect(mocks.extract).toHaveBeenCalledOnce();
	});
	it("shows upload failures and makes no model request", async () => {
		mocks.open.mockRejectedValue(new Error("The PDF is damaged"));
		setup();
		fireEvent.change(document.querySelector("input[type=file]")!, {
			target: { files: [new File(["bad"], "bad.pdf")] },
		});
		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent("The PDF is damaged"),
		);
		expect(mocks.extract).not.toHaveBeenCalled();
	});
	it("does not write remaining PDF pages into a different session", async () => {
		mocks.extract.mockImplementation(async () => {
			mocks.session.currentConversationId = "another-session";
			return item;
		});
		setup();
		await upload();
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Pages to convert" }),
			"all",
		);
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent("Extraction stopped"),
		);
		expect(mocks.extract).toHaveBeenCalledOnce();
	});
	it("restores text, its source image and layout boxes from history", async () => {
		setup([item]);
		expect(screen.getByRole("heading", { name: "Report" })).toBeVisible();
		expect(screen.getByRole("img", { name: "report.pdf" })).toHaveAttribute(
			"src",
			"inputs/page.png",
		);
		expect(
			screen
				.getByRole("group", { name: "Include layout boxes" })
				.querySelectorAll("rect"),
		).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Download" })).toBeVisible();
	});
	it("converts custom PDF pages and rejects invalid ranges before sending requests", async () => {
		setup();
		await upload();
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Pages to convert" }),
			"custom",
		);
		const pages = screen.getByRole("textbox", {
			name: "Page numbers or ranges",
		});
		await userEvent.type(pages, "1, 4");
		expect(pages).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("button", { name: "Extract text" })).toBeDisabled();
		expect(mocks.extract).not.toHaveBeenCalled();
		await userEvent.clear(pages);
		await userEvent.type(pages, "3, 1, 3");
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(2));
		expect(
			mocks.extract.mock.calls.map(([request]) => request.pageNumber),
		).toEqual([1, 3]);
		const requests = mocks.extract.mock.calls.map(([request]) => request);
		expect(requests[0]).toMatchObject({
			selectedPages: [1, 3],
			pageCount: 3,
			batchId: expect.any(String),
		});
		expect(requests[0].batchId).toBe(requests[1].batchId);
	});
	it("remembers exact instructions per model and can restore defaults", async () => {
		const { rerender, props, ui } = setup();
		await userEvent.click(
			screen.getByText("Model instructions", { selector: "summary" }),
		);
		const instructions = screen.getByRole("textbox", {
			name: "Model instructions",
		});
		await userEvent.clear(instructions);
		await userEvent.type(instructions, "Read this page:");
		rerender(
			ui({ ...props, model: { ...model, modelId: "org/another-model" } }),
		);
		await waitFor(() =>
			expect((instructions as HTMLTextAreaElement).value).toContain(
				"Transcribe all text",
			),
		);
		rerender(ui());
		await waitFor(() => expect(instructions).toHaveValue("Read this page:"));
		await upload();
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() =>
			expect(mocks.extract).toHaveBeenCalledWith(
				expect.objectContaining({ instructions: "Read this page:" }),
			),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Use default instructions" }),
		);
		expect((instructions as HTMLTextAreaElement).value).toContain(
			"Transcribe all text",
		);
	});
	it("links source regions and block cards across views and supports keyboard selection", async () => {
		const second = {
			type: "text" as const,
			role: "transcript" as const,
			text: "![text](10,200,900,300)\nSecond paragraph",
		};
		setup([{ ...item, parts: [...item.parts, second] }]);
		const region = screen.getByRole("button", { name: "text region 2" });
		const card = screen.getByRole("button", { name: "text block 2" });
		fireEvent.mouseEnter(card);
		expect(region).toHaveAttribute("data-active", "true");
		fireEvent.mouseLeave(card);
		expect(region).toHaveAttribute("data-active", "false");
		await userEvent.click(screen.getByRole("tab", { name: "Document" }));
		fireEvent.keyDown(region, { key: "Enter" });
		expect(screen.getByRole("tab", { name: "Blocks" })).toHaveAttribute(
			"data-state",
			"active",
		);
		expect(
			screen.getByRole("button", { name: "text block 2" }),
		).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(
			screen.getByRole("button", { name: "title block 1" }),
		);
		expect(
			screen.getByRole("button", { name: "title region 1" }),
		).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(
			screen.getByRole("button", { name: "Fit page to width" }),
		).toHaveTextContent("125%");
	});
	it("exposes structured data and saves the selected export format", async () => {
		setup([item]);
		await userEvent.click(screen.getByRole("tab", { name: "Data (JSON)" }));
		const data = JSON.parse(
			(
				screen.getByRole("textbox", {
					name: "Data (JSON)",
				}) as HTMLTextAreaElement
			).value,
		);
		expect(data.pages[0]).toMatchObject({
			pageNumber: 1,
			layout: [{ content: "# Report", label: "title" }],
		});
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Export format" }),
			"json",
		);
		const save = screen.getByRole("button", { name: "Save to Files" });
		expect(save).toHaveAttribute("data-file-name", "report-data.json");
		expect(JSON.parse(save.getAttribute("data-content")!)).toEqual(data);
		await userEvent.selectOptions(
			screen.getByRole("combobox", { name: "Export format" }),
			"html",
		);
		expect(
			screen.getByRole("button", { name: "Save to Files" }),
		).toHaveAttribute("data-file-name", "report-page-1.html");
	});
	it("cancels work and releases the document on unmount", async () => {
		let resolve!: (value: typeof item) => void;
		mocks.extract.mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const { unmount } = setup();
		await upload();
		await userEvent.click(screen.getByRole("button", { name: "Extract text" }));
		await waitFor(() => expect(mocks.extract).toHaveBeenCalledOnce());
		unmount();
		expect(mocks.close).toHaveBeenCalledOnce();
		expect(mocks.extract.mock.calls[0]![0].signal.aborted).toBe(true);
		await act(async () => resolve(item));
	});
});

describe("OCR document preview", () => {
	it("preserves document link text and inline markup without carrying over attributes", () => {
		const { container } = render(
			<OCRPreview
				markdown={
					'[Reference](https://example.com)\n\n<span style="position:fixed">Inline text</span>'
				}
			/>,
		);
		expect(container).toHaveTextContent("Reference");
		expect(container).toHaveTextContent("Inline text");
		expect(container.querySelector("[style], [href]")).toBeNull();
	});
	it("renders HTML chart tables while removing active content and model-provided styles", () => {
		const { container } = render(
			<OCRPreview
				markdown={
					'<table style="position:fixed"><tr><th>Year</th><th>Revenue</th></tr><tr><td>2025</td><td>10</td></tr></table><script>alert(1)</script><img src="https://example.com/track.png" /><iframe src="https://example.com" />'
				}
			/>,
		);
		expect(screen.getByRole("table")).toBeVisible();
		expect(screen.getByRole("cell", { name: "10" })).toBeVisible();
		expect(container.querySelector("script, img, iframe, [style]")).toBeNull();
	});
});
