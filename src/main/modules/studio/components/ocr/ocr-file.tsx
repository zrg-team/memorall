import { renderToStaticMarkup } from "react-dom/server";
import type { ocrResultData } from "./ocr-data";
import { parseOCRLayout } from "./ocr-document";
import { OCRPreview } from "./OCRPreview";

export type OCRFileFormat = "markdown" | "json" | "html";
type OCRData = NonNullable<ReturnType<typeof ocrResultData>>;

/** Export a whole conversion batch, in document order. JSON retains raw output and coordinates. */
export function buildOCRFile(data: OCRData, format: OCRFileFormat) {
	const base = data.fileName.replace(/\.[^.]+$/, "") || "ocr";
	const suffix =
		data.pages.length === 1 ? `-page-${data.pages[0]!.pageNumber}` : "-pages";
	if (format === "json")
		return {
			fileName: `${base}-data.json`,
			mimeType: "application/json;charset=utf-8",
			content: JSON.stringify(data, null, 2),
		};
	if (format === "markdown")
		return {
			fileName: `${base}${suffix}.md`,
			mimeType: "text/markdown;charset=utf-8",
			content: data.pages
				.map((page) => {
					const content =
						parseOCRLayout(page.markdown).markdown ||
						`[${page.status}${page.error ? `: ${page.error}` : ""}]`;
					return data.pages.length > 1
						? `# Page ${page.pageNumber}\n\n${content}`
						: content;
				})
				.join("\n\n---\n\n"),
		};
	const markup = renderToStaticMarkup(
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{data.fileName}</title>
				<style>
					{
						"body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui,sans-serif;color:#18212f}section{margin-bottom:40px}header{color:#667085;font-size:13px;border-bottom:1px solid #ddd;padding-bottom:8px}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccc;padding:6px 12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f5f7;padding:16px}blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:16px}@media print{section{break-before:page}section:first-child{break-before:auto}}"
					}
				</style>
			</head>
			<body>
				{data.pages.map((page) => (
					<section key={page.pageNumber}>
						<header>
							{data.fileName} · Page {page.pageNumber} · {page.model.id} ·{" "}
							{page.status}
						</header>
						<OCRPreview markdown={parseOCRLayout(page.markdown).markdown} />
						{page.error ? <p>{page.error}</p> : null}
					</section>
				))}
			</body>
		</html>,
	);
	return {
		fileName: `${base}${suffix}.html`,
		mimeType: "text/html;charset=utf-8",
		content: `<!doctype html>\n${markup}`,
	};
}
