/**
 * PDF Content Script Handler
 * Handles PDF-specific operations triggered from context menus
 */

import {
	readPDFFromUrl,
	readPDFPages,
	isPDFUrl,
	type PDFDocumentContent,
} from "./pdf-extraction";
import {
	formatPDFAsText,
	formatPDFAsMarkdown,
	searchPDFContent,
	getPDFStats,
} from "@/lib/pdf-utils";
import { logInfo, logError } from "@/utils/logger";

/**
 * Extract entire PDF content and show notification
 */
export async function handleExtractPDF(url: string): Promise<void> {
	try {
		logInfo("📄 Extracting PDF content from:", url);

		if (!isPDFUrl(url)) {
			throw new Error("Current page is not a PDF");
		}

		const pdfContent = await readPDFFromUrl(url);
		const stats = getPDFStats(pdfContent);

		// Show success notification with stats
		const message =
			`Extracted ${pdfContent.numPages} pages\n` +
			`Words: ${stats.totalWords.toLocaleString()}\n` +
			`Characters: ${stats.totalCharacters.toLocaleString()}`;

		showNotification("PDF Extracted", message);

		// Store in session storage for access by other parts of the extension
		try {
			await chrome.storage.session.set({
				lastExtractedPDF: {
					url,
					content: pdfContent,
					extractedAt: new Date().toISOString(),
				},
			});
			logInfo("✅ PDF content stored in session storage");
		} catch (error) {
			logError("⚠️ Failed to store PDF in session:", error);
		}
	} catch (error) {
		logError("❌ Failed to extract PDF:", error);
		showNotification(
			"Extraction Failed",
			error instanceof Error ? error.message : "Failed to extract PDF",
		);
		throw error;
	}
}

/**
 * Extract specific page range from PDF
 */
export async function handleExtractPDFPages(url: string): Promise<void> {
	try {
		logInfo("📄 Extracting PDF pages from:", url);

		if (!isPDFUrl(url)) {
			throw new Error("Current page is not a PDF");
		}

		// Prompt user for page range
		const startPageStr = prompt("Enter start page number:", "1");
		if (!startPageStr) return; // User cancelled

		const endPageStr = prompt("Enter end page number:", "10");
		if (!endPageStr) return; // User cancelled

		const startPage = Number.parseInt(startPageStr, 10);
		const endPage = Number.parseInt(endPageStr, 10);

		if (Number.isNaN(startPage) || Number.isNaN(endPage)) {
			throw new Error("Invalid page numbers");
		}

		if (startPage > endPage) {
			throw new Error("Start page must be less than or equal to end page");
		}

		// Fetch PDF and extract pages
		const response = await fetch(url);
		const arrayBuffer = await response.arrayBuffer();
		const pages = await readPDFPages(arrayBuffer, startPage, endPage);

		const totalText = pages.map((p) => p.text).join("\n\n");
		const wordCount = totalText.split(/\s+/).filter((w) => w.length > 0).length;

		// Show success notification
		showNotification(
			"Pages Extracted",
			`Extracted pages ${startPage}-${endPage} (${pages.length} pages, ${wordCount} words)`,
		);

		// Store in session storage
		try {
			await chrome.storage.session.set({
				lastExtractedPDFPages: {
					url,
					startPage,
					endPage,
					pages,
					extractedAt: new Date().toISOString(),
				},
			});
		} catch (error) {
			logError("⚠️ Failed to store PDF pages in session:", error);
		}
	} catch (error) {
		logError("❌ Failed to extract PDF pages:", error);
		showNotification(
			"Extraction Failed",
			error instanceof Error ? error.message : "Failed to extract pages",
		);
		throw error;
	}
}

/**
 * Search within PDF
 */
export async function handleSearchPDF(url: string): Promise<void> {
	try {
		logInfo("🔍 Searching in PDF:", url);

		if (!isPDFUrl(url)) {
			throw new Error("Current page is not a PDF");
		}

		// Prompt user for search query
		const query = prompt("Enter search term:");
		if (!query) return; // User cancelled

		const pdfContent = await readPDFFromUrl(url);
		const results = searchPDFContent(pdfContent, query, false);

		if (results.length === 0) {
			showNotification("No Results", `No matches found for "${query}"`);
			return;
		}

		// Show first few results in notification
		const resultText = results
			.slice(0, 3)
			.map(
				(r, i) =>
					`${i + 1}. Page ${r.pageNumber}: ${r.context.substring(0, 50)}...`,
			)
			.join("\n");

		showNotification(
			`Found ${results.length} matches`,
			resultText + (results.length > 3 ? "\n..." : ""),
		);

		// Store results in session storage
		try {
			await chrome.storage.session.set({
				lastPDFSearchResults: {
					url,
					query,
					results,
					searchedAt: new Date().toISOString(),
				},
			});
		} catch (error) {
			logError("⚠️ Failed to store search results:", error);
		}
	} catch (error) {
		logError("❌ Failed to search PDF:", error);
		showNotification(
			"Search Failed",
			error instanceof Error ? error.message : "Failed to search PDF",
		);
		throw error;
	}
}

/**
 * Export PDF as plain text
 */
export async function handleExportPDFAsText(url: string): Promise<void> {
	try {
		logInfo("📝 Exporting PDF as text:", url);

		if (!isPDFUrl(url)) {
			throw new Error("Current page is not a PDF");
		}

		const pdfContent = await readPDFFromUrl(url);
		const textContent = formatPDFAsText(pdfContent);

		// Create and download text file
		downloadFile(
			textContent,
			`${sanitizeFilename(pdfContent.title || "document")}.txt`,
			"text/plain",
		);

		showNotification(
			"Export Complete",
			`Exported "${pdfContent.title}" as text`,
		);
	} catch (error) {
		logError("❌ Failed to export PDF as text:", error);
		showNotification(
			"Export Failed",
			error instanceof Error ? error.message : "Failed to export PDF",
		);
		throw error;
	}
}

/**
 * Export PDF as Markdown
 */
export async function handleExportPDFAsMarkdown(url: string): Promise<void> {
	try {
		logInfo("📝 Exporting PDF as Markdown:", url);

		if (!isPDFUrl(url)) {
			throw new Error("Current page is not a PDF");
		}

		const pdfContent = await readPDFFromUrl(url);
		const markdownContent = formatPDFAsMarkdown(pdfContent);

		// Create and download markdown file
		downloadFile(
			markdownContent,
			`${sanitizeFilename(pdfContent.title || "document")}.md`,
			"text/markdown",
		);

		showNotification(
			"Export Complete",
			`Exported "${pdfContent.title}" as Markdown`,
		);
	} catch (error) {
		logError("❌ Failed to export PDF as Markdown:", error);
		showNotification(
			"Export Failed",
			error instanceof Error ? error.message : "Failed to export PDF",
		);
		throw error;
	}
}

/**
 * Helper: Show notification
 */
function showNotification(title: string, message: string): void {
	// Create a simple toast-like notification in the page
	const notification = document.createElement("div");
	notification.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		background: #333;
		color: white;
		padding: 16px 24px;
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0,0,0,0.3);
		z-index: 999999;
		max-width: 400px;
		font-family: system-ui, -apple-system, sans-serif;
		animation: slideIn 0.3s ease-out;
	`;

	notification.innerHTML = `
		<style>
			@keyframes slideIn {
				from { transform: translateX(400px); opacity: 0; }
				to { transform: translateX(0); opacity: 1; }
			}
		</style>
		<div style="font-weight: bold; margin-bottom: 4px;">${escapeHtml(title)}</div>
		<div style="font-size: 14px; opacity: 0.9; white-space: pre-line;">${escapeHtml(message)}</div>
	`;

	document.body.appendChild(notification);

	// Remove after 5 seconds
	setTimeout(() => {
		notification.style.animation = "slideIn 0.3s ease-out reverse";
		setTimeout(() => notification.remove(), 300);
	}, 5000);
}

/**
 * Helper: Download file
 */
function downloadFile(
	content: string,
	filename: string,
	mimeType: string,
): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.style.display = "none";

	document.body.appendChild(a);
	a.click();

	setTimeout(() => {
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}, 100);
}

/**
 * Helper: Sanitize filename
 */
function sanitizeFilename(filename: string): string {
	return filename
		.replace(/[^a-z0-9]/gi, "_")
		.replace(/_+/g, "_")
		.substring(0, 100);
}

/**
 * Helper: Escape HTML
 */
function escapeHtml(text: string): string {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Main message handler for PDF operations
 */
export async function handlePDFMessage(message: {
	type: string;
	url: string;
}): Promise<{ success: boolean; error?: string }> {
	try {
		switch (message.type) {
			case "PDF_EXTRACT_PDF":
				await handleExtractPDF(message.url);
				break;
			case "PDF_EXTRACT_PDF_PAGES":
				await handleExtractPDFPages(message.url);
				break;
			case "PDF_SEARCH_PDF":
				await handleSearchPDF(message.url);
				break;
			case "PDF_EXPORT_PDF_TEXT":
				await handleExportPDFAsText(message.url);
				break;
			case "PDF_EXPORT_PDF_MARKDOWN":
				await handleExportPDFAsMarkdown(message.url);
				break;
			default:
				throw new Error(`Unknown PDF operation: ${message.type}`);
		}

		return { success: true };
	} catch (error) {
		logError("❌ PDF operation failed:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}
