import {
	WEB_CONTENT_COMMAND_SOURCE,
	type WebContentCommandRequest,
	type WebContentCommandResponse,
	type WebDomActionName,
	type WebDomElementInfo,
	type WebElementRecord,
} from "@/services/web-browser";

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const NON_READABLE_SELECTOR = "script, style, noscript, link, template";

const removeNonReadableNodes = (root: ParentNode): void => {
	root.querySelectorAll(NON_READABLE_SELECTOR).forEach((node) => node.remove());
};

const getReadableDocumentText = (): string => {
	const clonedDocument = document.cloneNode(true) as Document;
	removeNonReadableNodes(clonedDocument);
	return (
		clonedDocument.body?.innerText ||
		clonedDocument.documentElement?.textContent ||
		""
	).trim();
};

const buildWebSnapshot = () => ({
	url: window.location.href,
	title: document.title || "",
	html: document.documentElement?.outerHTML || document.body?.innerHTML || "",
	text: getReadableDocumentText(),
	domAccessible: true,
});

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
	text: (element.textContent ?? "").trim(),
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
	text: element.textContent ?? "",
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
		window.scrollTo({ top: document.body?.scrollHeight ?? 0, left: 0, behavior: "smooth" });
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
					snapshot: buildWebSnapshot(),
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
					snapshot: buildWebSnapshot(),
					elements,
				};
			}

			case "web-tool:dom-action": {
				const result = executeDomAction(request.action, request);
				return {
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:dom-action-result",
					success: true,
					snapshot: buildWebSnapshot(),
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
							snapshot: buildWebSnapshot(),
							matched: true,
						};
					}

					if (Date.now() - start >= request.timeoutMs) {
						return {
							source: WEB_CONTENT_COMMAND_SOURCE,
							type: "web-tool:wait-selector-result",
							success: true,
							snapshot: buildWebSnapshot(),
							matched: false,
						};
					}

					await new Promise((resolve) =>
						window.setTimeout(resolve, request.intervalMs),
					);
				}
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
