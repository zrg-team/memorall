import * as pdfjsLib from "pdfjs-dist";
import type {
	TextItem,
	TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";

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
 * Extract text content from a single PDF page
 */
async function extractPageText(
	page: pdfjsLib.PDFPageProxy,
): Promise<PDFPageContent> {
	const textContent = await page.getTextContent();
	const viewport = page.getViewport({ scale: 1.0 });

	// Extract text items and join them with spaces
	const text = textContent.items
		.map((item) => {
			if ("str" in item) {
				return (item as TextItem).str;
			}
			return "";
		})
		.join(" ");

	return {
		pageNumber: page.pageNumber,
		text: text.trim(),
		width: viewport.width,
		height: viewport.height,
	};
}

/**
 * Read a PDF file and extract all text content
 * @param file - File object or ArrayBuffer containing PDF data
 * @returns Promise with extracted PDF content
 */
export async function readPDFFile(
	file: File | ArrayBuffer,
): Promise<PDFDocumentContent> {
	try {
		// Convert File to ArrayBuffer if needed
		let data: ArrayBuffer;
		if (file instanceof File) {
			data = await file.arrayBuffer();
		} else {
			data = file;
		}

		// Load the PDF document
		const loadingTask = pdfjsLib.getDocument({ data });
		const pdf = await loadingTask.promise;

		// Extract metadata
		const metadata = await pdf.getMetadata();
		const info = metadata.info as Record<string, string>;

		// Extract text from all pages
		const pages: PDFPageContent[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const pageContent = await extractPageText(page);
			pages.push(pageContent);
		}

		// Combine all page texts
		const fullText = pages.map((page) => page.text).join("\n\n");

		return {
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
	} catch (error) {
		console.error("Error reading PDF file:", error);
		throw new Error(
			`Failed to read PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Extract text from a specific page range
 * @param file - File object or ArrayBuffer containing PDF data
 * @param startPage - Starting page number (1-based)
 * @param endPage - Ending page number (1-based, inclusive)
 */
export async function readPDFPages(
	file: File | ArrayBuffer,
	startPage: number,
	endPage: number,
): Promise<PDFPageContent[]> {
	try {
		let data: ArrayBuffer;
		if (file instanceof File) {
			data = await file.arrayBuffer();
		} else {
			data = file;
		}

		const loadingTask = pdfjsLib.getDocument({ data });
		const pdf = await loadingTask.promise;

		// Validate page range
		const actualStartPage = Math.max(1, startPage);
		const actualEndPage = Math.min(pdf.numPages, endPage);

		if (actualStartPage > actualEndPage) {
			throw new Error("Invalid page range");
		}

		// Extract text from specified pages
		const pages: PDFPageContent[] = [];
		for (let i = actualStartPage; i <= actualEndPage; i++) {
			const page = await pdf.getPage(i);
			const pageContent = await extractPageText(page);
			pages.push(pageContent);
		}

		return pages;
	} catch (error) {
		console.error("Error reading PDF pages:", error);
		throw new Error(
			`Failed to read PDF pages: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Check if a URL points to a PDF file
 */
export function isPDFUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname.toLowerCase();
		return pathname.endsWith(".pdf");
	} catch {
		return false;
	}
}

/**
 * Fetch and read a PDF from a URL
 */
export async function readPDFFromUrl(url: string): Promise<PDFDocumentContent> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch PDF: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return await readPDFFile(arrayBuffer);
	} catch (error) {
		console.error("Error fetching PDF from URL:", error);
		throw new Error(
			`Failed to fetch PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}
