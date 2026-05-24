import z from "zod";
import { marked } from "marked";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import type { WebToolServices } from "../web/web-tool-utils";
import { ensureFolderExists } from "../../utils/document-fs-utils";
import { writeFileBytes } from "../fs/util";

const TOOL_NAME = "pdf_generate" as const;

const schema = z.object({
	source_type: z
		.enum(["url", "markdown", "html"])
		.describe(
			"Input source type. `url` opens a web page; `markdown` converts markdown text; `html` renders raw HTML.",
		),
	content: z
		.string()
		.describe(
			"URL string, markdown text, or HTML string depending on source_type.",
		),
	output_path: z
		.string()
		.describe("Where to save the PDF in /documents. Must end with .pdf."),
	options: z
		.object({
			page_size: z
				.enum(["a4", "letter", "legal"])
				.optional()
				.describe("Page size (default: a4)."),
			orientation: z
				.enum(["portrait", "landscape"])
				.optional()
				.describe("Page orientation (default: portrait)."),
			margin_mm: z
				.number()
				.optional()
				.describe("Page margin in millimetres (default: 10)."),
		})
		.optional(),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "webBrowser" | "fs">;

const wrapHtml = (body: string): string => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #111; }
  h1, h2, h3, h4 { margin-top: 1.2em; margin-bottom: 0.4em; }
  p { margin: 0.6em 0; }
  pre { background: #f4f4f4; padding: 8px; border-radius: 4px; overflow-x: auto; }
  code { font-family: monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; }
  th { background: #f0f0f0; }
  a { color: #0066cc; }
</style>
</head>
<body>${body}</body>
</html>`;

const resolveHtml = async (
	input: Input,
	webBrowserServices: WebToolServices,
): Promise<string> => {
	if (input.source_type === "markdown") {
		const html = await marked.parse(input.content);
		return wrapHtml(html);
	}

	if (input.source_type === "html") {
		const lower = input.content.trimStart().toLowerCase();
		return lower.startsWith("<!doctype") || lower.startsWith("<html")
			? input.content
			: wrapHtml(input.content);
	}

	// url: open the page and read its HTML
	const webBrowser = webBrowserServices.webBrowser;
	if (!webBrowser) {
		throw new Error("Web browser service is required for source_type='url'.");
	}
	const { session, disposable } = await webBrowser.openSession({
		url: input.content,
		timeoutMs: 20_000,
		persist: false,
		mode: "tab",
	});
	const html = session.html;
	if (disposable) {
		await webBrowser.closeSession(session.id).catch(() => {});
	}
	return html || wrapHtml(`<p>No content loaded from: ${input.content}</p>`);
};

export const createPdfGenerateTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Generate a PDF from a web URL, markdown text, or HTML string and save it to /documents. Returns the saved file path and page count.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return JSON.stringify({
				actionType: "pdf_generate",
				success: false,
				error: "Document filesystem service is not available.",
			});
		}

		const filePath = normalizeDocumentPath(input.output_path);
		if (!filePath.toLowerCase().endsWith(".pdf")) {
			return JSON.stringify({
				actionType: "pdf_generate",
				success: false,
				error: `output_path must end with .pdf, got: ${input.output_path}`,
			});
		}

		try {
			const htmlContent = await resolveHtml(input, services);

			const { jsPDF } = await import("jspdf");

			const opts = input.options ?? {};
			const doc = new jsPDF({
				orientation: opts.orientation ?? "portrait",
				unit: "mm",
				format: opts.page_size ?? "a4",
			});

			const marginMm = opts.margin_mm ?? 10;
			const container = document.createElement("div");
			container.style.cssText =
				"position:fixed;top:-99999px;left:-99999px;width:794px;font-size:13px;";
			container.innerHTML = htmlContent;
			document.body.appendChild(container);

			await doc.html(container, {
				margin: [marginMm, marginMm, marginMm, marginMm],
				autoPaging: "text",
				html2canvas: { scale: 0.75, useCORS: true, logging: false },
				width: 190,
				windowWidth: 794,
			});

			document.body.removeChild(container);

			const pageCount = doc.getNumberOfPages();
			const pdfBytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);

			const lastSlash = filePath.lastIndexOf("/");
			const parentPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : "/";

			await ensureFolderExists(dfs, parentPath);
			await writeFileBytes(dfs, filePath, pdfBytes);

			return JSON.stringify(
				{
					actionType: "pdf_generate",
					success: true,
					file_path: filePath,
					page_count: pageCount,
					source_type: input.source_type,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				actionType: "pdf_generate",
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

toolRegistry.register(TOOL_NAME, createPdfGenerateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
