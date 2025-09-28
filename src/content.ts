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
function storeRememberContext(context?: string, showTopicSelector?: boolean) {
	const contextData = {
		context,
		pageUrl: window.location.href,
		pageTitle: document.title,
		timestamp: new Date().toISOString(),
	};

	// Store in session storage for the popup to access
	try {
		const storageData: any = { rememberContext: contextData };
		if (showTopicSelector) {
			storageData.showTopicSelector = true;
		}
		chrome.storage?.session?.set?.(storageData);
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
			topicId: null,
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

			// Include topicId if provided
			if (message.topicId) {
				extractedData.topicId = message.topicId;
			}

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
			storeRememberContext(message.context, message.showTopicSelector);

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
	} else if (message.type === CONTENT_BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR) {
		try {
			// Show topic selector UI on the page
			createTopicSelectorUI(
				message.context || "",
				window.location.href,
				document.title,
			);

			sendResponse({ success: true });
		} catch (error) {
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to show topic selector",
			});
		}

		return true;
	}
});

// Create compact topic selector UI
function createTopicSelectorUI(
	context: string,
	pageUrl: string,
	pageTitle: string,
) {
	// Remove any existing selector
	const existingSelector = document.getElementById("memorall-topic-selector");
	if (existingSelector) {
		existingSelector.remove();
	}

	// Calculate position near mouse, ensuring it stays within viewport
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const selectorWidth = 200;
	const selectorHeight = 80; // Approximate height

	let x = lastMouseX + 10; // Small offset from mouse
	let y = lastMouseY + 10;

	// Adjust if it would go off screen
	if (x + selectorWidth > viewportWidth) {
		x = lastMouseX - selectorWidth - 10;
	}
	if (y + selectorHeight > viewportHeight) {
		y = lastMouseY - selectorHeight - 10;
	}

	// Ensure minimum distance from edges
	x = Math.max(10, Math.min(x, viewportWidth - selectorWidth - 10));
	y = Math.max(10, Math.min(y, viewportHeight - selectorHeight - 10));

	// Create compact topic selector container
	const selectorContainer = document.createElement("div");
	selectorContainer.id = "memorall-topic-selector";
	selectorContainer.style.cssText = `
		position: fixed;
		top: ${y}px;
		left: ${x}px;
		background: white;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
		padding: 12px;
		z-index: 999999;
		min-width: 200px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 13px;
	`;

	// Create content
	selectorContainer.innerHTML = `
		<label style="display: block; margin-bottom: 6px; font-weight: 500; color: #374151;">
			Select Topic:
		</label>
		<select id="memorall-topic-select" style="
			width: 100%;
			padding: 6px 8px;
			border: 1px solid #d1d5db;
			border-radius: 4px;
			font-size: 13px;
			background: white;
		">
			<option value="">Loading topics...</option>
		</select>
	`;

	const select = selectorContainer.querySelector(
		"#memorall-topic-select",
	) as HTMLSelectElement;

	// Auto-select and save when topic is chosen
	select.addEventListener("change", async () => {
		const selectedTopicId = select.value;
		if (!selectedTopicId) return;

		// Send context data with selected topic directly to background script for saving
		try {
			console.log("🔍 Content script sending topicId:", selectedTopicId);
			await chrome.runtime.sendMessage({
				type: "REMEMBER_CONTENT_WITH_TOPIC",
				context,
				pageUrl,
				pageTitle,
				timestamp: new Date().toISOString(),
				topicId: selectedTopicId,
			});

			// Show brief success message
			selectorContainer.innerHTML = `
				<div style="color: #16a34a; font-weight: 500; text-align: center;">
					✓ Saved to topic
				</div>
			`;

			// Remove after 2 seconds
			setTimeout(() => {
				selectorContainer.remove();
			}, 2000);
		} catch (error) {
			console.error("Failed to save content with topic:", error);

			// Show error message
			selectorContainer.innerHTML = `
				<div style="color: #dc2626; font-weight: 500; text-align: center;">
					✗ Failed to save
				</div>
			`;

			setTimeout(() => {
				selectorContainer.remove();
			}, 3000);
		}
	});

	// Load topics
	loadTopicsForSelector(select);

	// Add to page
	document.body.appendChild(selectorContainer);

	// Auto-remove after 30 seconds if no selection
	setTimeout(() => {
		if (document.getElementById("memorall-topic-selector")) {
			selectorContainer.remove();
		}
	}, 30000);
}

// Load topics from background
async function loadTopicsForSelector(select: HTMLSelectElement) {
	try {
		// Request topics from background script
		const response = await chrome.runtime.sendMessage({
			type: "GET_TOPICS_FOR_SELECTOR",
		});

		if (response?.success && response?.topics) {
			// Clear loading option
			select.innerHTML = '<option value="">Choose a topic...</option>';

			// Add topic options
			response.topics.forEach((topic: any) => {
				const option = document.createElement("option");
				option.value = topic.id;
				option.textContent = topic.name;
				select.appendChild(option);
			});
		} else {
			select.innerHTML = '<option value="">No topics available</option>';
		}
	} catch (error) {
		console.error("Failed to load topics:", error);
		select.innerHTML = '<option value="">Failed to load topics</option>';
	}
}

// Track last mouse position for context menu
let lastMouseX = 0;
let lastMouseY = 0;

// Track mouse position for context menu positioning
document.addEventListener("contextmenu", (e) => {
	lastMouseX = e.clientX;
	lastMouseY = e.clientY;
});

// Initialize content script
console.log("🚀 Memorall content script loaded on:", window.location.href);
