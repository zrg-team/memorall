import { Readability } from "@mozilla/readability";
import {
	isPDFUrl,
	readPDFFromUrl,
} from "@/main/modules/files/handlers/pdf-extraction";
import type {
	SelectionData,
	PageMetadata,
	ReadableContent,
	ExtractedPageData,
} from "./types";
import { logError, logWarn } from "@/utils/logger";

// Clean HTML element to keep only tag structure
function cleanHTMLElement(
	element: Element,
	maxDepth = 50,
	currentDepth = 0,
): string {
	if (currentDepth >= maxDepth) {
		return `<!-- Max depth reached -->`;
	}

	// Skip script, style, noscript, and other non-visual elements
	const skipTags = ["script", "style", "noscript", "meta", "link", "br", "hr"];
	if (skipTags.includes(element.tagName.toLowerCase())) {
		return "";
	}

	const tagName = element.tagName.toLowerCase();

	// Special handling for span tags - unwrap them and keep content
	if (tagName === "span") {
		const parts: string[] = [];

		// Process all child nodes (text and elements)
		for (const child of Array.from(element.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				// Text node - add text content directly
				const text = child.textContent?.trim();
				if (text) {
					parts.push(text);
				}
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				// Element node - recursively clean it
				const childHTML = cleanHTMLElement(
					child as Element,
					maxDepth,
					currentDepth + 1,
				);
				if (childHTML) {
					parts.push(childHTML);
				}
			}
		}

		// Return the unwrapped content
		return parts.join("");
	}

	// Special handling for code tags - replace with backticks to save tokens
	if (tagName === "code") {
		const textContent = element.textContent?.trim() || "";
		if (textContent) {
			return `\`${textContent}\``;
		}
		return "";
	}

	// Special handling for svg tags - keep wrapper only to save tokens
	if (tagName === "svg") {
		const indent = "  ".repeat(currentDepth);
		return `${indent}<svg>...</svg>`;
	}

	// Only keep URLs - href and src attributes with FULL URLs
	let attrString = "";
	const href = element.getAttribute("href");
	const src = element.getAttribute("src");

	if (href) {
		attrString += ` href="${href}"`;
	}
	if (src) {
		attrString += ` src="${src}"`;
	}

	// Self-closing tags
	const selfClosing = ["img", "input", "br", "hr", "meta", "link"];
	if (selfClosing.includes(tagName)) {
		return `<${tagName}${attrString} />`;
	}

	// Process children
	const children: string[] = [];
	for (const child of Array.from(element.children)) {
		const childHTML = cleanHTMLElement(child, maxDepth, currentDepth + 1);
		if (childHTML) {
			children.push(childHTML);
		}
	}

	// Format output with indentation
	const indent = "  ".repeat(currentDepth);
	const childIndent = "  ".repeat(currentDepth + 1);

	if (children.length === 0) {
		// Get actual text content - keep full content, no truncation
		const textContent = element.textContent?.trim() || "";
		if (textContent) {
			return `${indent}<${tagName}${attrString}>${textContent}</${tagName}>`;
		}
		return `${indent}<${tagName}${attrString}></${tagName}>`;
	}

	const childrenString = children.map((c) => childIndent + c).join("\n");
	return `${indent}<${tagName}${attrString}>\n${childrenString}\n${indent}</${tagName}>`;
}

export function extractElementTextContent(element: Element): string {
	if (element instanceof HTMLElement) {
		return element.innerText.trim() || element.textContent?.trim() || "";
	}
	return element.textContent?.trim() || "";
}

export function extractElementCleanHTML(element: Element): string {
	return cleanHTMLElement(element, 50, 0);
}

export function extractElementOuterHTML(element: Element): string {
	return element.outerHTML;
}

// Extract HTML structure from viewport (visible area only)
export function extractViewportHTMLStructure(): string {
	// Get all elements in the viewport
	const allElements = document.body.querySelectorAll("*");
	const viewportElements = new Set<Element>();

	allElements.forEach((el) => {
		try {
			const rect = el.getBoundingClientRect();
			const isInViewport =
				rect.top < window.innerHeight &&
				rect.bottom > 0 &&
				rect.left < window.innerWidth &&
				rect.right > 0;

			if (!isInViewport) return;

			// Check visibility
			const style = window.getComputedStyle(el);
			const isVisible =
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				parseFloat(style.opacity) > 0;

			if (isVisible) {
				viewportElements.add(el);
			}
		} catch (e) {
			// Skip elements that cause errors
		}
	});

	// Find the common ancestor(s) of viewport elements
	// For simplicity, we'll start from body and filter to viewport elements
	function buildViewportStructure(element: Element, depth = 0): string | null {
		// Skip if not in viewport or not visible
		if (!viewportElements.has(element) && depth > 0) {
			// Check if any children are in viewport
			const hasViewportChildren = Array.from(element.children).some(
				(child) =>
					viewportElements.has(child) ||
					Array.from(child.querySelectorAll("*")).some((desc) =>
						viewportElements.has(desc),
					),
			);
			if (!hasViewportChildren) {
				return null;
			}
		}

		const tagName = element.tagName.toLowerCase();
		const skipTags = ["script", "style", "noscript", "meta", "link"];

		if (skipTags.includes(tagName)) {
			return null;
		}

		// Special handling for span tags - unwrap them
		if (tagName === "span") {
			const parts: string[] = [];

			// Process all child nodes (text and elements)
			for (const child of Array.from(element.childNodes)) {
				if (child.nodeType === Node.TEXT_NODE) {
					// Text node - add text content directly
					const text = child.textContent?.trim();
					if (text) {
						parts.push(text);
					}
				} else if (child.nodeType === Node.ELEMENT_NODE) {
					// Element node - recursively process it
					const childStructure = buildViewportStructure(
						child as Element,
						depth,
					);
					if (childStructure) {
						parts.push(childStructure);
					}
				}
			}

			// Return the unwrapped content
			return parts.length > 0 ? parts.join("") : null;
		}

		// Special handling for code tags - replace with backticks to save tokens
		if (tagName === "code") {
			const textContent = element.textContent?.trim() || "";
			if (textContent) {
				return `\`${textContent}\``;
			}
			return null;
		}

		// Special handling for svg tags - keep wrapper only to save tokens
		if (tagName === "svg") {
			const indent = "  ".repeat(depth);
			return `${indent}<svg>...</svg>`;
		}

		// Build simplified structure
		const indent = "  ".repeat(depth);
		let result = `${indent}<${tagName}>`;

		let hasVisibleChildren = false;
		for (const child of Array.from(element.children)) {
			const childStructure = buildViewportStructure(child, depth + 1);
			if (childStructure) {
				if (!hasVisibleChildren) {
					result += "\n";
					hasVisibleChildren = true;
				}
				result += childStructure + "\n";
			}
		}

		if (hasVisibleChildren) {
			result += `${indent}</${tagName}>`;
		} else {
			// Keep actual text content, no truncation
			const textContent = element.textContent?.trim() || "";
			result = `${indent}<${tagName}>${textContent}</${tagName}>`;
		}

		return result;
	}

	const structure = buildViewportStructure(document.body);

	return (
		structure || `<body>${document.body?.textContent?.trim() || ""}</body>`
	);
}

// Extract full page HTML structure
export function extractFullPageHTMLStructure(): string {
	try {
		// Start from body to avoid head clutter, use max depth of 50
		const bodyStructure = cleanHTMLElement(document.body, 50, 0);

		// Add basic page structure
		return `<html>
  <head>
    <title>${document.title || "Document"}</title>
  </head>
  <body>
${bodyStructure}
  </body>
</html>`;
	} catch (error) {
		logWarn("Failed to extract HTML structure:", error);
		return "<html><body><!-- Failed to extract structure --></body></html>";
	}
}

// Extract content visible in current viewport (what user sees)
export function extractViewportContent(): string {
	const elements: string[] = [];
	const seenTexts = new Set<string>(); // Avoid duplicate text

	// Get ALL elements that might contain text - cast as wide a net as possible
	const allElements = document.querySelectorAll("*");

	allElements.forEach((el) => {
		try {
			// Skip non-content elements
			const tagName = el.tagName.toLowerCase();
			const skipTags = [
				"script",
				"style",
				"noscript",
				"meta",
				"link",
				"svg",
				"iframe",
			];
			if (skipTags.includes(tagName)) return;

			// Check if element is in viewport
			const rect = el.getBoundingClientRect();
			const isInViewport =
				rect.top < window.innerHeight &&
				rect.bottom > 0 &&
				rect.left < window.innerWidth &&
				rect.right > 0;

			if (!isInViewport) return;

			// Check if element has visible dimensions
			const hasVisibleSize = rect.width > 0 && rect.height > 0;
			if (!hasVisibleSize) return;

			// Check if element is visible
			const style = window.getComputedStyle(el);
			const isVisible =
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				parseFloat(style.opacity) > 0;

			if (!isVisible) return;

			// Only extract text from leaf elements (no child elements)
			// This avoids duplicate text from parent containers
			const hasChildElements = el.children.length > 0;
			if (hasChildElements) return;

			// Get text content from this leaf element only
			const text = el.textContent?.trim();

			// Add any meaningful text (longer than 5 chars, not duplicate)
			if (text && text.length > 5 && !seenTexts.has(text)) {
				seenTexts.add(text);
				elements.push(text);
			}
		} catch (e) {
			// Skip elements that cause errors
		}
	});

	// Join with line breaks - get as much text as possible
	return elements.join("\n\n");
}

// Extract current selection with context
export function extractSelection(selectedText: string): SelectionData {
	const selection = window.getSelection();
	let selectionContext = "";

	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		const container = range.commonAncestorContainer;

		// Get full surrounding text for context - NO LIMIT
		if (container.textContent) {
			selectionContext = container.textContent;
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
			excerpt: pdfContent.fullText, // Full text, no truncation
			byline: pdfContent.author || "",
			dir: "ltr",
			lang: "en",
			siteName: window.location.hostname,
		};
	} catch (error) {
		logError("Failed to extract PDF content:", error);
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
		// Fallback: extract basic text content - NO TRUNCATION
		const title = document.title || "";
		const textContent = document.body?.innerText || "";

		return {
			title,
			content: textContent,
			textContent,
			length: textContent.length,
			excerpt: textContent, // Full text, no truncation
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
