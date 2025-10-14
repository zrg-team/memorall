import {
	readPDFFile,
	type PDFDocumentContent,
} from "@/embedded/pdf-extraction";

/**
 * Create a file input element and prompt user to select a PDF file
 */
export function createPDFFileInput(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".pdf,application/pdf";

		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			resolve(file || null);
		};

		input.oncancel = () => {
			resolve(null);
		};

		input.click();
	});
}

/**
 * Read PDF file selected by user through file input
 */
export async function selectAndReadPDF(): Promise<PDFDocumentContent | null> {
	try {
		const file = await createPDFFileInput();
		if (!file) {
			return null;
		}

		if (!file.type.includes("pdf")) {
			throw new Error("Selected file is not a PDF");
		}

		return await readPDFFile(file);
	} catch (error) {
		console.error("Error reading PDF file:", error);
		throw error;
	}
}

/**
 * Handle PDF file drop event
 */
export async function handlePDFDrop(
	event: DragEvent,
): Promise<PDFDocumentContent | null> {
	event.preventDefault();

	const file = event.dataTransfer?.files[0];
	if (!file) {
		return null;
	}

	if (!file.type.includes("pdf")) {
		throw new Error("Dropped file is not a PDF");
	}

	return await readPDFFile(file);
}

/**
 * Extract text content from PDF file with progress callback
 */
export async function readPDFWithProgress(
	file: File,
	onProgress?: (progress: number) => void,
): Promise<PDFDocumentContent> {
	try {
		// Read the file
		const arrayBuffer = await file.arrayBuffer();

		// Report 50% progress after file is loaded
		onProgress?.(0.5);

		// Extract PDF content
		const content = await readPDFFile(arrayBuffer);

		// Report 100% progress
		onProgress?.(1.0);

		return content;
	} catch (error) {
		console.error("Error reading PDF with progress:", error);
		throw error;
	}
}

/**
 * Format PDF content as plain text with page separators
 */
export function formatPDFAsText(pdf: PDFDocumentContent): string {
	let text = "";

	// Add metadata as header
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

	// Add page content
	for (const page of pdf.pages) {
		text += `--- Page ${page.pageNumber} ---\n\n`;
		text += page.text + "\n\n";
	}

	return text;
}

/**
 * Format PDF content as Markdown
 */
export function formatPDFAsMarkdown(pdf: PDFDocumentContent): string {
	let markdown = "";

	// Add metadata as frontmatter
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

	// Add title
	if (pdf.title) {
		markdown += `# ${pdf.title}\n\n`;
	}

	// Add metadata
	if (pdf.author) {
		markdown += `**Author:** ${pdf.author}\n\n`;
	}

	// Add page content
	for (const page of pdf.pages) {
		markdown += `## Page ${page.pageNumber}\n\n`;
		markdown += page.text + "\n\n";
	}

	return markdown;
}

/**
 * Search for text in PDF document
 */
export function searchPDFContent(
	pdf: PDFDocumentContent,
	query: string,
	caseSensitive = false,
): Array<{ pageNumber: number; text: string; context: string }> {
	const results: Array<{ pageNumber: number; text: string; context: string }> =
		[];
	const searchQuery = caseSensitive ? query : query.toLowerCase();

	for (const page of pdf.pages) {
		const pageText = caseSensitive ? page.text : page.text.toLowerCase();

		let index = 0;
		while ((index = pageText.indexOf(searchQuery, index)) !== -1) {
			// Get context around the match (100 chars before and after)
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
 * Get statistics about PDF document
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
