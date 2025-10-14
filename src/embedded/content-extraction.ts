import { Readability } from "@mozilla/readability";
import { isPDFUrl, readPDFFromUrl } from "./pdf-extraction";
import type {
	SelectionData,
	PageMetadata,
	ReadableContent,
	ExtractedPageData,
} from "./types";

// Extract current selection with context
export function extractSelection(selectedText: string): SelectionData {
	const selection = window.getSelection();
	let selectionContext = "";

	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		const container = range.commonAncestorContainer;

		// Get surrounding text for context (up to 200 chars before and after)
		if (container.textContent) {
			const fullText = container.textContent;
			const startIndex = Math.max(0, fullText.indexOf(selectedText) - 200);
			const endIndex = Math.min(
				fullText.length,
				fullText.indexOf(selectedText) + selectedText.length + 200,
			);
			selectionContext = fullText.substring(startIndex, endIndex);
		}
	}

	return {
		selectedText,
		selectionContext,
		pageUrl: window.location.href,
		pageTitle: document.title,
		timestamp: new Date().toISOString(),
		selectionRange:
			selection && selection.rangeCount > 0
				? {
						startOffset: selection.getRangeAt(0).startOffset,
						endOffset: selection.getRangeAt(0).endOffset,
					}
				: undefined,
	};
}

// Extract page metadata
export function extractPageMetadata(): PageMetadata {
	const url = window.location.href;
	const title = document.title || "";
	const domain = window.location.hostname;

	// Extract favicon
	let favicon = "";
	const faviconLink = document.querySelector(
		'link[rel="shortcut icon"], link[rel="icon"]',
	);
	if (faviconLink) {
		favicon = new URL((faviconLink as HTMLLinkElement).href, url).href;
	} else {
		favicon = `${window.location.protocol}//${domain}/favicon.ico`;
	}

	// Extract Open Graph data
	const ogTitle = document
		.querySelector('meta[property="og:title"]')
		?.getAttribute("content");
	const ogDescription = document
		.querySelector('meta[property="og:description"]')
		?.getAttribute("content");
	const ogImage = document
		.querySelector('meta[property="og:image"]')
		?.getAttribute("content");
	const ogSiteName = document
		.querySelector('meta[property="og:site_name"]')
		?.getAttribute("content");

	// Extract meta description
	const metaDescription = document
		.querySelector('meta[name="description"]')
		?.getAttribute("content");

	return {
		url,
		title: ogTitle || title,
		favicon,
		description: ogDescription || metaDescription || "",
		ogImage: ogImage ? new URL(ogImage, url).href : "",
		timestamp: new Date().toISOString(),
		domain,
		siteName: ogSiteName || domain,
	};
}

// Extract PDF content
export async function extractPDFContent(url: string): Promise<ReadableContent> {
	try {
		const pdfContent = await readPDFFromUrl(url);

		// Create a formatted content with page numbers
		const formattedContent = pdfContent.pages
			.map(
				(page) => `<div class="pdf-page" data-page="${page.pageNumber}">
				<h3>Page ${page.pageNumber}</h3>
				<p>${page.text}</p>
			</div>`,
			)
			.join("\n");

		return {
			title: pdfContent.title || document.title || "PDF Document",
			content: formattedContent,
			textContent: pdfContent.fullText,
			length: pdfContent.fullText.length,
			excerpt:
				pdfContent.fullText.substring(0, 300) +
				(pdfContent.fullText.length > 300 ? "..." : ""),
			byline: pdfContent.author || "",
			dir: "ltr",
			lang: "en",
			siteName: window.location.hostname,
		};
	} catch (error) {
		console.error("Failed to extract PDF content:", error);
		throw error;
	}
}

// Clean and extract readable content using Readability
export async function extractReadableContent(): Promise<ReadableContent> {
	try {
		// Check if current page is a PDF
		if (isPDFUrl(window.location.href)) {
			return await extractPDFContent(window.location.href);
		}

		// Clone the document for Readability processing
		const documentClone = document.cloneNode(true) as Document;

		// Create Readability instance
		const reader = new Readability(documentClone, {
			// Configure Readability options
			debug: false,
			maxElemsToParse: 0, // No limit
			nbTopCandidates: 5,
			charThreshold: 500,
			classesToPreserve: ["page-break-before", "page-break-after"],
		});

		// Parse the content
		const article = reader.parse();

		if (!article) {
			throw new Error("Failed to parse article content");
		}

		return {
			title: article.title || document.title,
			content: article.content || "",
			textContent: article.textContent || "",
			length: article.length || 0,
			excerpt: article.excerpt || "",
			byline: article.byline || "",
			dir: article.dir || document.dir || "ltr",
			lang: article.lang || document.documentElement.lang || "en",
			siteName: article.siteName || window.location.hostname,
		};
	} catch (error) {
		// Fallback: extract basic text content
		const title = document.title || "";
		const textContent = document.body?.innerText || "";

		return {
			title,
			content: textContent,
			textContent,
			length: textContent.length,
			excerpt:
				textContent.substring(0, 300) + (textContent.length > 300 ? "..." : ""),
			byline: "",
			dir: document.dir || "ltr",
			lang: document.documentElement.lang || "en",
			siteName: window.location.hostname,
		};
	}
}

// Main content extraction function
export async function extractPageContent(): Promise<ExtractedPageData> {
	try {
		// Extract metadata and readable content in parallel
		const [metadata, article] = await Promise.all([
			Promise.resolve(extractPageMetadata()),
			extractReadableContent(),
		]);

		const data: ExtractedPageData = {
			html: document.documentElement.outerHTML,
			url: window.location.href,
			title: article.title || metadata.title,
			metadata: {
				...metadata,
				title: article.title || metadata.title,
			},
			topicId: null,
			article,
		};

		return data;
	} catch (error) {
		throw error;
	}
}
