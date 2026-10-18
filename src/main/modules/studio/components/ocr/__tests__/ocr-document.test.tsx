import { beforeEach, describe, expect, it, vi } from "vitest";
import { openOCRDocument } from "../ocr-document";

const mocks = vi.hoisted(() => ({
	getPage: vi.fn(),
	render: vi.fn(),
	cleanup: vi.fn(),
	close: vi.fn(),
	cancel: vi.fn(),
}));
vi.mock("@/main/modules/files/handlers/pdf-extraction", () => ({
	openPDFDocument: async () => ({
		doc: { numPages: 4, getPage: mocks.getPage },
		close: mocks.close,
	}),
}));
const file = {
	name: "report.pdf",
	type: "application/pdf",
	size: 100,
	arrayBuffer: async () => new ArrayBuffer(100),
} as File;

describe("OCR PDF rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.close.mockResolvedValue(undefined);
		mocks.render.mockReturnValue({
			promise: Promise.resolve(),
			cancel: mocks.cancel,
		});
		mocks.getPage.mockResolvedValue({
			getViewport: ({ scale }: { scale: number }) => ({
				width: 612 * scale,
				height: 792 * scale,
			}),
			render: mocks.render,
			cleanup: mocks.cleanup,
		});
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => callback(new Blob(["png"], { type: "image/png" })),
		);
	});
	it("renders only the requested page within the model's resolution and releases its canvas", async () => {
		const document = await openOCRDocument(file);
		expect(document.pageCount).toBe(4);
		expect(mocks.getPage).not.toHaveBeenCalled();
		const blob = await document.renderPage(3);
		expect(mocks.getPage).toHaveBeenCalledWith(3);
		expect(blob.type).toBe("image/png");
		const { viewport, canvas } = mocks.render.mock.calls[0]![0];
		expect(viewport.height).toBe(1540);
		expect(viewport.width / viewport.height).toBeCloseTo(612 / 792);
		expect(canvas.width).toBe(0);
		expect(mocks.cleanup).toHaveBeenCalledOnce();
		document.close();
		expect(mocks.close).toHaveBeenCalledOnce();
	});
	it("does not fetch pages outside the document", async () => {
		const document = await openOCRDocument(file);
		await expect(document.renderPage(0)).rejects.toThrow("Invalid page");
		await expect(document.renderPage(5)).rejects.toThrow("Invalid page");
		expect(mocks.getPage).not.toHaveBeenCalled();
	});
	it("cancels rendering and frees the page when stopped", async () => {
		let reject!: (reason: unknown) => void;
		mocks.cancel.mockImplementation(() =>
			reject(new DOMException("Stopped", "AbortError")),
		);
		mocks.render.mockReturnValue({
			promise: new Promise((_done, fail) => {
				reject = fail;
			}),
			cancel: mocks.cancel,
		});
		const document = await openOCRDocument(file);
		const controller = new AbortController();
		const result = document.renderPage(1, controller.signal);
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalled());
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.cancel).toHaveBeenCalledOnce();
		expect(mocks.cleanup).toHaveBeenCalledOnce();
	});
});
