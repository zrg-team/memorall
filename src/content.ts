// Content script for Memorall extension
// Extracts page content using Mozilla Readability
import { Readability } from "@mozilla/readability";
import { CONTENT_BACKGROUND_EVENTS } from "./constants/content-background";

// We import Readability as a module so it runs in the
// content script's isolated world (no DOM injection required).

// Extract current selection with context
function extractSelection(selectedText: string) {
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

// Store context data for the remember page
function storeRememberContext(context?: string) {
	const contextData = {
		context,
		pageUrl: window.location.href,
		pageTitle: document.title,
		timestamp: new Date().toISOString(),
	};

	// Store in session storage for the popup to access
	try {
		chrome.storage?.session?.set?.({ rememberContext: contextData });
	} catch (error) {
		console.error("Failed to store remember context:", error);
	}

	return contextData;
}

// Extract page metadata
function extractPageMetadata() {
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

// Clean and extract readable content using Readability
async function extractReadableContent() {
	try {
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
async function extractPageContent() {
	try {
		// Extract metadata and readable content in parallel
		const [metadata, article] = await Promise.all([
			Promise.resolve(extractPageMetadata()),
			extractReadableContent(),
		]);

		const data = {
			html: document.documentElement.outerHTML,
			url: window.location.href,
			title: article.title || metadata.title,
			metadata: {
				...metadata,
				title: article.title || metadata.title,
			},
			article,
		};
		return data;
	} catch (error) {
		throw error;
	}
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (message, _sender, sendResponse) => {
	if (message.type === CONTENT_BACKGROUND_EVENTS.REMEMBER_THIS) {
		try {
			// Extract page content
			const extractedData = await extractPageContent();

			// Send extracted content back to background script
			const payload = {
				type: CONTENT_BACKGROUND_EVENTS.CONTENT_EXTRACTED,
				tabId: message.tabId as number,
				data: extractedData,
			};

			let response;
			try {
				response = await chrome.runtime.sendMessage(payload);
			} catch (err) {
				// Ignore errors if background is not reachable
			}

			// Reply to the original REMEMBER_THIS message regardless
			sendResponse(
				response ?? { success: false, error: "No response from background" },
			);
		} catch (error) {
			sendResponse({
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to extract content",
			});
		}

		// Return true to indicate async response
		return true;
	} else if (message.type === CONTENT_BACKGROUND_EVENTS.REMEMBER_CONTENT) {
		try {
			// Extract selection metadata
			const selectionMetadata = extractSelection(message.selectedText);

			// Send extracted selection back to background script
			const payload = {
				type: CONTENT_BACKGROUND_EVENTS.SELECTION_EXTRACTED,
				tabId: message.tabId as number,
				data: {
					selectedText: message.selectedText,
					selectionContext: selectionMetadata.selectionContext,
					url: window.location.href,
					title: document.title,
					sourceMetadata: selectionMetadata,
				},
			};

			let response;
			try {
				response = await chrome.runtime.sendMessage(payload);
			} catch (err) {
				console.error(
					"❌ Failed sending SELECTION_EXTRACTED to background:",
					err,
				);
			}

			sendResponse(
				response ?? { success: false, error: "No response from background" },
			);
		} catch (error) {
			console.error("❌ Selection extraction failed:", error);
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to extract selection",
			});
		}

		return true;
	} else if (message.type === CONTENT_BACKGROUND_EVENTS.LET_REMEMBER) {
		try {
			// Store context data for the popup to access
			storeRememberContext(message.context);

			// Response handled immediately - no UI shown in content script
			sendResponse({ success: true });
		} catch (error) {
			sendResponse({
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to store context",
			});
		}

		return true;
	}
});

// Initialize content script
console.log("🚀 Memorall content script loaded on:", window.location.href);
