/**
 * @vitest-environment jsdom
 *
 * A URL that is a file (a PDF, an image, an archive) instead of a page: the
 * web tools save it and read its text rather than reading an empty viewer.
 */
import { describe, expect, it, vi } from "vitest";
import type { IFlowFileSystem } from "../interfaces/services/filesystem.js";
import type {
	WebDownloadedResource,
	WebSession,
} from "../interfaces/services/web-browser.js";
import {
	isPageContentType,
	looksLikeFileUrl,
} from "../tools/web/file-content-type.js";
import { createWebDownloadTool } from "../tools/web/web-download.js";
import { createWebOpenTool } from "../tools/web/web-open.js";
import { createWebReadTool } from "../tools/web/web-read.js";
import type { WebResourceServices } from "../tools/web/web-resource.js";
import { createWebSearchTool } from "../tools/web/web-search.js";
import {
	filenameFromContentDisposition,
	refineMimeType,
	resourceFileName,
} from "../utils/download-resource.js";
import { setHtmlParser } from "../utils/html-parser.js";

setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));

const PDF_URL = "https://arxiv.org/pdf/2610.32253";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 fake");

const pdfSession = (overrides: Partial<WebSession> = {}): WebSession =>
	({
		id: "session-pdf",
		requestedUrl: PDF_URL,
		currentUrl: PDF_URL,
		title: "",
		html: '<html><body><embed type="application/pdf"></body></html>',
		text: "",
		domAccessible: true,
		contentType: "application/pdf",
		lastAccessedAt: 0,
		createdAt: 0,
		mode: "window",
		tabId: 7,
		...overrides,
	}) as WebSession;

const memoryFs = () => {
	const files = new Map<string, Uint8Array>();
	const fs = {
		mkdir: vi.fn(async () => {}),
		writeFile: vi.fn(async (path: string, data: string | Uint8Array) => {
			files.set(
				path,
				typeof data === "string" ? new TextEncoder().encode(data) : data,
			);
		}),
	} as unknown as IFlowFileSystem;
	return { fs, files };
};

const harness = (options: {
	opened?: WebSession;
	openError?: Error;
	resource?: Partial<WebDownloadedResource>;
	text?: string | null;
}) => {
	const { fs, files } = memoryFs();
	const openSession = vi.fn(async () => {
		if (options.openError) throw options.openError;
		return { session: options.opened, disposable: false, renderReady: true };
	});
	const downloadResource = vi.fn(
		async (): Promise<WebDownloadedResource> => ({
			url: PDF_URL,
			mimeType: "application/pdf",
			bytes: PDF_BYTES,
			...options.resource,
		}),
	);
	const readResourceText = vi.fn(async () =>
		options.text === undefined
			? "--- Page 1 ---\n\nAttention is all"
			: options.text,
	);
	const waitForPageRender = vi.fn();
	const searchInSessionHtml = vi.fn(async () => []);
	const webBrowser = {
		openSession,
		getOrOpenSession: openSession,
		refreshSession: vi.fn(async () => options.opened),
		closeSession: vi.fn(async () => {}),
		waitForPageRender,
		searchInSessionHtml,
		downloadResource,
		readResourceText,
	};
	return {
		services: { webBrowser, fs } as unknown as WebResourceServices,
		files,
		openSession,
		downloadResource,
		readResourceText,
		waitForPageRender,
		searchInSessionHtml,
	};
};

const run = async (
	tool: { execute: (input: never, context?: never) => unknown },
	input: Record<string, unknown>,
) => JSON.parse((await tool.execute(input as never)) as string);

describe("file detection", () => {
	it("tells pages from files by type", () => {
		expect(isPageContentType("text/html; charset=utf-8")).toBe(true);
		expect(isPageContentType("application/json")).toBe(true);
		expect(isPageContentType("application/rss+xml")).toBe(true);
		expect(isPageContentType(undefined)).toBe(true);
		expect(isPageContentType("application/pdf")).toBe(false);
		expect(isPageContentType("image/svg+xml")).toBe(false);
		expect(isPageContentType("video/mp4")).toBe(false);
		expect(isPageContentType("application/zip")).toBe(false);
	});

	it("tells file addresses by extension", () => {
		expect(looksLikeFileUrl("https://example.com/paper.PDF")).toBe(true);
		expect(looksLikeFileUrl("https://example.com/a/archive.zip?x=1")).toBe(
			true,
		);
		expect(looksLikeFileUrl(PDF_URL)).toBe(false);
		expect(looksLikeFileUrl("https://example.com/page.html")).toBe(false);
		expect(looksLikeFileUrl("https://example.com/")).toBe(false);
		expect(looksLikeFileUrl("not a url")).toBe(false);
	});

	it("names a saved file with its type's extension", () => {
		expect(resourceFileName(PDF_URL, "application/pdf")).toBe("2610.32253.pdf");
		expect(resourceFileName("https://x.test/p.pdf", "application/pdf")).toBe(
			"p.pdf",
		);
		expect(resourceFileName("https://x.test/a.jpeg", "image/jpeg")).toBe(
			"a.jpeg",
		);
		expect(resourceFileName("https://x.test/data.json", "text/plain")).toBe(
			"data.json",
		);
		expect(
			resourceFileName("https://x.test/get?id=1", "application/pdf", "Q3.pdf"),
		).toBe("Q3.pdf");
		expect(resourceFileName("https://x.test/", "application/zip")).toBe(
			"download.zip",
		);
	});

	it("reads Content-Disposition names", () => {
		expect(
			filenameFromContentDisposition('attachment; filename="report 1.pdf"'),
		).toBe("report 1.pdf");
		expect(
			filenameFromContentDisposition(
				"attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
			),
		).toBe("résumé.pdf");
		expect(filenameFromContentDisposition("inline")).toBeUndefined();
	});

	it("recognises a PDF served as octet-stream, and trusts a named type", () => {
		expect(refineMimeType("application/octet-stream", PDF_BYTES)).toBe(
			"application/pdf",
		);
		expect(refineMimeType("text/plain", PDF_BYTES)).toBe("text/plain");
	});
});

describe("web_open on a file", () => {
	it("downloads a PDF the tab is showing, through that tab", async () => {
		const h = harness({ opened: pdfSession() });
		const result = await run(createWebOpenTool(h.services), { url: PDF_URL });

		expect(h.downloadResource).toHaveBeenCalledWith(
			expect.objectContaining({ url: PDF_URL, sessionId: "session-pdf" }),
		);
		expect(h.waitForPageRender).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			success: true,
			sessionId: "session-pdf",
			renderReady: true,
			file: {
				path: "/tmp/downloads/2610.32253.pdf",
				mimeType: "application/pdf",
				size: PDF_BYTES.length,
			},
			text: "--- Page 1 ---\n\nAttention is all",
		});
		expect(h.files.get("/tmp/downloads/2610.32253.pdf")).toEqual(PDF_BYTES);
	});

	it("saves a file address without opening a tab", async () => {
		const h = harness({});
		const result = await run(createWebOpenTool(h.services), {
			url: "https://example.com/files/paper.pdf",
		});

		expect(h.openSession).not.toHaveBeenCalled();
		expect(result.file.path).toBe("/tmp/downloads/2610.32253.pdf");
		expect(result.sessionId).toBeUndefined();
	});

	it("opens the page when a file address serves a page instead", async () => {
		const page = pdfSession({
			id: "session-login",
			contentType: "text/html",
			html: "<html><body><main>Please sign in to read this paper</main></body></html>",
			text: "Please sign in to read this paper",
		});
		const h = harness({
			opened: page,
			resource: { mimeType: "text/html", bytes: new Uint8Array() },
		});
		const result = await run(createWebOpenTool(h.services), {
			url: "https://example.com/files/paper.pdf",
		});

		expect(h.openSession).toHaveBeenCalled();
		expect(h.files.size).toBe(0);
		expect(result.sessionId).toBe("session-login");
		expect(result.file).toBeUndefined();
	});

	it("recovers a download whose tab the browser closed", async () => {
		const h = harness({
			openError: new Error("The browser web session tab was closed."),
			resource: {
				url: "https://example.com/archive",
				mimeType: "application/zip",
				filename: "source.zip",
			},
			text: null,
		});
		const result = await run(createWebOpenTool(h.services), {
			url: "https://example.com/archive",
		});

		expect(result.success).toBe(true);
		expect(result.file.path).toBe("/tmp/downloads/source.zip");
		expect(result.text).toBeNull();
		expect(result.hint).toContain("no text");
	});

	it("still reports a failed open of a page", async () => {
		const h = harness({
			openError: new Error("net::ERR_NAME_NOT_RESOLVED"),
			resource: { mimeType: "text/html" },
		});
		const result = await run(createWebOpenTool(h.services), {
			url: "https://nowhere.invalid/",
		});

		expect(result).toMatchObject({
			success: false,
			error: "net::ERR_NAME_NOT_RESOLVED",
		});
	});
});

describe("web_read and web_find_in_page on a file", () => {
	it("reads a PDF session's text", async () => {
		const h = harness({ opened: pdfSession() });
		const result = await run(createWebReadTool(h.services), {
			sessionId: "session-pdf",
		});

		expect(result).toMatchObject({
			actionType: "web_read",
			sessionId: "session-pdf",
			contentMode: "text",
			content: "--- Page 1 ---\n\nAttention is all",
			file: { path: "/tmp/downloads/2610.32253.pdf" },
		});
	});

	it("finds text inside a PDF session", async () => {
		const h = harness({
			opened: pdfSession(),
			text: "--- Page 1 ---\nScaled dot-product attention\n--- Page 2 ---\nMulti-head attention",
		});
		const result = await run(createWebSearchTool(h.services), {
			sessionId: "session-pdf",
			pattern: "ATTENTION",
		});

		expect(h.searchInSessionHtml).not.toHaveBeenCalled();
		expect(result.count).toBe(2);
		expect(result.matches[1].text).toBe("Multi-head attention");
		expect(result.file.path).toBe("/tmp/downloads/2610.32253.pdf");
	});
});

describe("web_download", () => {
	it("saves to /tmp/downloads by default", async () => {
		const h = harness({});
		const result = await run(createWebDownloadTool(h.services), {
			url: PDF_URL,
		});

		expect(h.readResourceText).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			actionType: "web_download",
			success: true,
			file_path: "/tmp/downloads/2610.32253.pdf",
			mimeType: "application/pdf",
		});
		expect(result.text).toBeUndefined();
	});

	it("saves into a given folder or path, with text on request", async () => {
		const h = harness({});
		const intoFolder = await run(createWebDownloadTool(h.services), {
			url: PDF_URL,
			file_path: "/projects/papers/",
			includeText: true,
		});
		const toPath = await run(createWebDownloadTool(h.services), {
			url: PDF_URL,
			file_path: "/projects/attention.pdf",
		});

		expect(intoFolder.file_path).toBe("/projects/papers/2610.32253.pdf");
		expect(intoFolder.text).toBe("--- Page 1 ---\n\nAttention is all");
		expect(toPath.file_path).toBe("/projects/attention.pdf");
	});

	it("passes the session so the page's login applies", async () => {
		const h = harness({});
		await run(createWebDownloadTool(h.services), {
			url: PDF_URL,
			sessionId: "session-1",
		});

		expect(h.downloadResource).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "session-1" }),
		);
	});

	it("needs a filesystem", async () => {
		const h = harness({});
		const result = await run(
			createWebDownloadTool({
				webBrowser: h.services.webBrowser,
			} as WebResourceServices),
			{ url: PDF_URL },
		);

		expect(result.success).toBe(false);
	});
});
