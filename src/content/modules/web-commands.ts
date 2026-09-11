import {
	extractElementSource,
	extractElementText,
	extractReadableDocumentText,
} from "@/services/web-browser/readable-text";
import {
	WEB_CONTENT_COMMAND_SOURCE,
	type WebContentCommandRequest,
	type WebContentCommandResponse,
	type WebDomActionName,
	type WebDomElementInfo,
	type WebElementRecord,
} from "@/services/web-browser/web-browser-protocol";

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Hard ceiling on each string a snapshot carries.
 *
 * Chrome drops any extension message over 64 MiB, and the sender gets no useful
 * error for it — the channel just closes, the tabs sendMessage call rejects
 * with "The message port closed before a response was received", and the
 * background normalises that to "Content script unavailable". So an oversized
 * page reads as a content script that never loaded, on a page whose script is
 * alive and well.
 *
 * A snapshot carries `html` and `text` together and is relayed over two further
 * hops, so budget each string to well under half the limit. A caller asking for
 * an unbounded snapshot (the background passes `Number.MAX_SAFE_INTEGER` to mean
 * "everything") gets everything up to this, rather than a dropped reply.
 */
const SNAPSHOT_TRANSPORT_CEILING = 24_000_000;

const TRUNCATION_MARKER = "\n…[truncated by Memorall: snapshot size limit]";

const capSnapshotString = (value: string, limit: number): string =>
	value.length <= limit ? value : value.slice(0, limit) + TRUNCATION_MARKER;

const snapshotLimit = (maxHtmlChars?: number): number =>
	typeof maxHtmlChars === "number" && Number.isFinite(maxHtmlChars)
		? Math.min(
				Math.max(Math.trunc(maxHtmlChars), 0),
				SNAPSHOT_TRANSPORT_CEILING,
			)
		: SNAPSHOT_TRANSPORT_CEILING;

const buildWebSnapshot = (maxHtmlChars?: number) => {
	const limit = snapshotLimit(maxHtmlChars);
	return {
		url: window.location.href,
		title: document.title || "",
		html: capSnapshotString(
			document.documentElement?.outerHTML || document.body?.innerHTML || "",
			limit,
		),
		text: capSnapshotString(extractReadableDocumentText(document), limit),
		domAccessible: true,
	};
};

// ── DOM element utilities ─────────────────────────────────────────────────────

const isElementVisible = (element: Element): boolean => {
	if (!(element instanceof HTMLElement)) return true;
	if (element.hidden) return false;
	const style = window.getComputedStyle(element);
	if (style.display === "none" || style.visibility === "hidden") return false;
	return Boolean(
		element.offsetWidth ||
			element.offsetHeight ||
			element.getClientRects().length,
	);
};

const acceptsTextInput = (element: Element): boolean => {
	if (element instanceof HTMLTextAreaElement) return true;
	if (!(element instanceof HTMLInputElement)) return false;
	const inputType = (element.type || "text").toLowerCase();
	return [
		"",
		"text",
		"search",
		"email",
		"url",
		"tel",
		"password",
		"number",
		"date",
		"datetime-local",
		"month",
		"time",
		"week",
	].includes(inputType);
};

const createDomElementInfo = (
	element: Element,
	index: number,
): WebDomElementInfo => ({
	index,
	tagName: element.tagName.toLowerCase(),
	id: element.getAttribute("id"),
	name: element.getAttribute("name"),
	type: element.getAttribute("type"),
	placeholder: element.getAttribute("placeholder"),
	ariaLabel:
		element.getAttribute("aria-label") ||
		element.getAttribute("aria-labelledby"),
	title: element.getAttribute("title"),
	role: element.getAttribute("role"),
	text: extractElementText(element),
	value:
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
			? element.value
			: null,
	href:
		element instanceof HTMLAnchorElement ||
		element instanceof HTMLAreaElement ||
		element instanceof HTMLLinkElement
			? element.getAttribute("href")
			: null,
	src: extractElementSource(element),
	disabled:
		(element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement ||
			element instanceof HTMLButtonElement) &&
		element.disabled,
	visible: isElementVisible(element),
	acceptsTextInput: acceptsTextInput(element),
});

const createElementRecord = (element: Element): WebElementRecord => ({
	label: element.tagName.toLowerCase(),
	text: extractElementText(element),
	value:
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
			? element.value
			: null,
});

const getIndexedElement = (selector: string, index: number): Element => {
	const node = document.querySelectorAll(selector).item(index);
	if (!node) {
		throw new Error(`No element at index ${index} for selector: ${selector}`);
	}
	if (!(node instanceof Element)) {
		throw new Error("Matched node is not a valid Element.");
	}
	return node;
};

const assertTextInputTarget = (element: Element): void => {
	if (element instanceof HTMLTextAreaElement) return;
	if (!(element instanceof HTMLInputElement)) {
		throw new Error("Target element does not support text input.");
	}
	if (!acceptsTextInput(element)) {
		throw new Error(
			`Target element is input[type=${element.type || "text"}] and does not support text input. Query again and choose a visible element with acceptsTextInput=true.`,
		);
	}
};

const executeDomAction = (
	action: WebDomActionName,
	request: Extract<WebContentCommandRequest, { type: "web-tool:dom-action" }>,
): WebElementRecord => {
	const element = getIndexedElement(request.selector, request.index ?? 0);

	if (action === "focus") {
		(element as HTMLElement).focus();
		return createElementRecord(element);
	}

	if (action === "scrollBottom") {
		window.scrollTo({
			top: document.body?.scrollHeight ?? 0,
			left: 0,
			behavior: "smooth",
		});
		return createElementRecord(element);
	}

	if (action === "scrollTop") {
		window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
		return createElementRecord(element);
	}

	if (action === "read") {
		return createElementRecord(element);
	}

	if (action === "click") {
		if (typeof (element as HTMLElement).click !== "function") {
			throw new Error("Target element does not support click.");
		}
		(element as HTMLElement).click();
		return createElementRecord(element);
	}

	if (action === "input") {
		assertTextInputTarget(element);
		const inputValue = request.value ?? "";
		(element as HTMLElement).focus();
		if (
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement
		) {
			element.value = inputValue;
			element.dispatchEvent(new Event("input", { bubbles: true }));
			element.dispatchEvent(new Event("change", { bubbles: true }));
		}
		return {
			label: element.tagName.toLowerCase(),
			text:
				element instanceof HTMLInputElement ||
				element instanceof HTMLTextAreaElement
					? element.value
					: "",
			value: inputValue,
		};
	}

	throw new Error(`Unsupported dom action: ${action}`);
};

// ── Error response ────────────────────────────────────────────────────────────

const WEB_CONTENT_ERROR_TYPE: Record<
	WebContentCommandRequest["type"],
	WebContentCommandResponse["type"]
> = {
	"web-tool:snapshot": "web-tool:snapshot-result",
	"web-tool:dom-query": "web-tool:dom-query-result",
	"web-tool:dom-action": "web-tool:dom-action-result",
	"web-tool:wait-selector": "web-tool:wait-selector-result",
	"web-tool:fetch-image": "web-tool:fetch-image-result",
	"web-tool:open-image-tab": "web-tool:open-image-tab-result",
	"web-tool:read-rendered-image": "web-tool:read-rendered-image-result",
};

const createWebContentErrorResponse = (
	request: WebContentCommandRequest,
	error: unknown,
): WebContentCommandResponse => ({
	source: WEB_CONTENT_COMMAND_SOURCE,
	type: WEB_CONTENT_ERROR_TYPE[request.type],
	success: false,
	error: error instanceof Error ? error.message : String(error),
});

// ── Main handler ──────────────────────────────────────────────────────────────

export const handleWebContentCommand = async (
	request: WebContentCommandRequest,
): Promise<WebContentCommandResponse> => {
	try {
		switch (request.type) {
			case "web-tool:snapshot":
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:snapshot-result",
					success: true,
					snapshot: buildWebSnapshot(request.maxHtmlChars),
				};

			case "web-tool:dom-query": {
				const elements = Array.from(document.querySelectorAll(request.selector))
					.filter((node): node is Element => node instanceof Element)
					.slice(0, request.maxResults)
					.map((element, index) => createDomElementInfo(element, index));

				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:dom-query-result",
					success: true,
					snapshot: buildWebSnapshot(request.maxHtmlChars),
					elements,
				};
			}

			case "web-tool:dom-action": {
				const result = executeDomAction(request.action, request);
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:dom-action-result",
					success: true,
					snapshot: buildWebSnapshot(request.maxHtmlChars),
					result,
				};
			}

			case "web-tool:wait-selector": {
				const start = Date.now();
				const expectPresent = request.state === "present";
				while (true) {
					const matched = Boolean(document.querySelector(request.selector));
					if ((expectPresent && matched) || (!expectPresent && !matched)) {
						return {
							source: WEB_CONTENT_COMMAND_SOURCE,
							type: "web-tool:wait-selector-result",
							success: true,
							snapshot: buildWebSnapshot(request.maxHtmlChars),
							matched: true,
						};
					}

					if (Date.now() - start >= request.timeoutMs) {
						return {
							source: WEB_CONTENT_COMMAND_SOURCE,
							type: "web-tool:wait-selector-result",
							success: true,
							snapshot: buildWebSnapshot(request.maxHtmlChars),
							matched: false,
						};
					}

					await new Promise((resolve) =>
						window.setTimeout(resolve, request.intervalMs),
					);
				}
			}

			case "web-tool:open-image-tab": {
				// Must happen here rather than through the extension tabs API: a tab the
				// extension opens carries no Referer, so a host with hotlink
				// protection refuses the navigation. Opened by the page, the request
				// carries that page's Referer and is served.
				const opened = window.open(request.url, "_blank");
				if (!opened) {
					throw new Error(
						"The page refused to open the image in a tab (popup blocked).",
					);
				}
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:open-image-tab-result",
					success: true,
				};
			}

			case "web-tool:read-rendered-image": {
				// Runs in a tab showing the image itself, so the document is
				// same-origin with it and the canvas is not tainted. Re-fetching here
				// would send this tab's own Referer and be refused again.
				const image = document.querySelector("img");
				if (!image || !image.naturalWidth) {
					throw new Error("This tab is not displaying a loaded image.");
				}
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext("2d");
				if (!context) {
					throw new Error("Could not read the image: no canvas context.");
				}
				context.drawImage(image, 0, 0);
				const dataUrl = canvas.toDataURL("image/png");
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:read-rendered-image-result",
					success: true,
					base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
					mimeType: "image/png",
					width: image.naturalWidth,
					height: image.naturalHeight,
				};
			}

			case "web-tool:fetch-image": {
				const res = await fetch(request.url);
				if (!res.ok) {
					throw new Error(`Failed to fetch image: HTTP ${res.status}`);
				}
				const buffer = await res.arrayBuffer();
				const mimeType =
					res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
				const bytes = new Uint8Array(buffer);
				let binary = "";
				const chunkSize = 8192;
				for (let i = 0; i < bytes.length; i += chunkSize) {
					binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
				}
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:fetch-image-result",
					success: true,
					base64: btoa(binary),
					mimeType,
				};
			}
		}
	} catch (error) {
		return createWebContentErrorResponse(request, error);
	}
};
