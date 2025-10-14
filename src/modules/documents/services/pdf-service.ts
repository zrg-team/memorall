/**
 * PDF Service - Background Script Handler
 * Handles PDF operations without content script (for Chrome's PDF viewer)
 */

import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// Configure PDF.js worker to use bundled worker file
// The worker file is copied to public/vendors/pdfjs by the build script
if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
	pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
		"vendors/pdfjs/pdf.worker.min.mjs",
	);
} else {
	// Fallback for non-extension environments (development)
	pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendors/pdfjs/pdf.worker.min.mjs`;
}

console.log(
	"📄 PDF.js worker configured:",
	pdfjsLib.GlobalWorkerOptions.workerSrc,
);

export interface PDFPageContent {
	pageNumber: number;
	text: string;
	width: number;
	height: number;
}

export interface PDFDocumentContent {
	title: string;
	author: string;
	subject: string;
	creator: string;
	producer: string;
	creationDate: string;
	modificationDate: string;
	numPages: number;
	pages: PDFPageContent[];
	fullText: string;
}

/**
 * Check if URL is a PDF
 */
export function isPDFUrl(url: string): boolean {
	if (!url) return false;
	return url.toLowerCase().includes(".pdf");
}

/**
 * Fetch and read PDF from URL
 */
export async function fetchAndReadPDF(
	url: string,
): Promise<PDFDocumentContent> {
	try {
		console.log("📄 Fetching PDF from:", url);

		// Fetch the PDF
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch PDF: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		console.log("📄 PDF fetched, size:", arrayBuffer.byteLength, "bytes");

		// Parse with PDF.js
		const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
		const pdf = await loadingTask.promise;

		console.log("📄 PDF loaded, pages:", pdf.numPages);

		// Extract metadata
		const metadata = await pdf.getMetadata();
		const info = (metadata.info as Record<string, string>) || {};

		// Extract text from all pages
		const pages: PDFPageContent[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const viewport = page.getViewport({ scale: 1.0 });
			const textContent = await page.getTextContent();

			const text = textContent.items
				.map((item) => {
					if ("str" in item) {
						return (item as TextItem).str;
					}
					return "";
				})
				.join(" ");

			pages.push({
				pageNumber: i,
				text: text.trim(),
				width: viewport.width,
				height: viewport.height,
			});

			console.log(`📄 Extracted page ${i}/${pdf.numPages}`);
		}

		// Combine all page texts
		const fullText = pages.map((page) => page.text).join("\n\n");

		const result: PDFDocumentContent = {
			title: info.Title || "",
			author: info.Author || "",
			subject: info.Subject || "",
			creator: info.Creator || "",
			producer: info.Producer || "",
			creationDate: info.CreationDate || "",
			modificationDate: info.ModDate || "",
			numPages: pdf.numPages,
			pages,
			fullText,
		};

		console.log("✅ PDF extraction complete:", {
			title: result.title,
			pages: result.numPages,
			textLength: result.fullText.length,
		});

		return result;
	} catch (error) {
		console.error("❌ Failed to fetch and read PDF:", error);
		throw new Error(
			`Failed to read PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Extract specific page range
 */
export async function extractPDFPages(
	url: string,
	startPage: number,
	endPage: number,
): Promise<PDFPageContent[]> {
	try {
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();

		const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
		const pdf = await loadingTask.promise;

		const actualStartPage = Math.max(1, startPage);
		const actualEndPage = Math.min(pdf.numPages, endPage);

		if (actualStartPage > actualEndPage) {
			throw new Error("Invalid page range");
		}

		const pages: PDFPageContent[] = [];
		for (let i = actualStartPage; i <= actualEndPage; i++) {
			const page = await pdf.getPage(i);
			const viewport = page.getViewport({ scale: 1.0 });
			const textContent = await page.getTextContent();

			const text = textContent.items
				.map((item) => {
					if ("str" in item) {
						return (item as TextItem).str;
					}
					return "";
				})
				.join(" ");

			pages.push({
				pageNumber: i,
				text: text.trim(),
				width: viewport.width,
				height: viewport.height,
			});
		}

		return pages;
	} catch (error) {
		throw new Error(
			`Failed to extract pages: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Search in PDF
 */
export function searchInPDF(
	pdfContent: PDFDocumentContent,
	query: string,
	caseSensitive = false,
): Array<{ pageNumber: number; text: string; context: string }> {
	const results: Array<{ pageNumber: number; text: string; context: string }> =
		[];
	const searchQuery = caseSensitive ? query : query.toLowerCase();

	for (const page of pdfContent.pages) {
		const pageText = caseSensitive ? page.text : page.text.toLowerCase();

		let index = 0;
		while ((index = pageText.indexOf(searchQuery, index)) !== -1) {
			const start = Math.max(0, index - 100);
			const end = Math.min(page.text.length, index + query.length + 100);
			const context = page.text.substring(start, end);

			results.push({
				pageNumber: page.pageNumber,
				text: page.text.substring(index, index + query.length),
				context,
			});

			index += query.length;
		}
	}

	return results;
}

/**
 * Format PDF as text
 */
export function formatPDFAsText(pdf: PDFDocumentContent): string {
	let text = "";

	if (pdf.title) {
		text += `Title: ${pdf.title}\n`;
	}
	if (pdf.author) {
		text += `Author: ${pdf.author}\n`;
	}
	if (pdf.subject) {
		text += `Subject: ${pdf.subject}\n`;
	}
	text += `Pages: ${pdf.numPages}\n`;
	text += "\n" + "=".repeat(80) + "\n\n";

	for (const page of pdf.pages) {
		text += `--- Page ${page.pageNumber} ---\n\n`;
		text += page.text + "\n\n";
	}

	return text;
}

/**
 * Format PDF as Markdown
 */
export function formatPDFAsMarkdown(pdf: PDFDocumentContent): string {
	let markdown = "";

	markdown += "---\n";
	if (pdf.title) {
		markdown += `title: "${pdf.title}"\n`;
	}
	if (pdf.author) {
		markdown += `author: "${pdf.author}"\n`;
	}
	if (pdf.subject) {
		markdown += `subject: "${pdf.subject}"\n`;
	}
	markdown += `pages: ${pdf.numPages}\n`;
	markdown += "---\n\n";

	if (pdf.title) {
		markdown += `# ${pdf.title}\n\n`;
	}

	if (pdf.author) {
		markdown += `**Author:** ${pdf.author}\n\n`;
	}

	for (const page of pdf.pages) {
		markdown += `## Page ${page.pageNumber}\n\n`;
		markdown += page.text + "\n\n";
	}

	return markdown;
}

/**
 * Get PDF statistics
 */
export function getPDFStats(pdf: PDFDocumentContent): {
	totalPages: number;
	totalCharacters: number;
	totalWords: number;
	averageWordsPerPage: number;
	averageCharactersPerPage: number;
} {
	const totalWords = pdf.fullText
		.split(/\s+/)
		.filter((w) => w.length > 0).length;
	const totalCharacters = pdf.fullText.length;

	return {
		totalPages: pdf.numPages,
		totalCharacters,
		totalWords,
		averageWordsPerPage: Math.round(totalWords / pdf.numPages),
		averageCharactersPerPage: Math.round(totalCharacters / pdf.numPages),
	};
}

/**
 * Download file helper (creates downloadable blob)
 */
export async function triggerDownload(
	content: string,
	filename: string,
	mimeType: string,
): Promise<{ url: string; filename: string }> {
	// Create blob URL
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);

	return { url, filename };
}
