import type {
	CoAgentElementInfo,
	CoAgentImageInfo,
	CoAgentPageSnapshot,
	CoAgentRect,
	CoAgentViewport,
} from "@/co-agent/protocol";
import {
	DEFAULT_TEXT_MAX_CHARS,
	DEFAULT_VISIBLE_TEXT_MAX_CHARS,
} from "@/co-agent/constants";

export const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

export const truncate = (value: string, maxChars: number): string => {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n...truncated`;
};

const normalizeTextRange = (
	total: number,
	options: { textStart?: number; maxChars: number },
) => {
	const from = Math.max(0, Math.floor(options.textStart ?? 0));
	const cappedTo = Math.min(total, from + options.maxChars);
	return {
		from,
		to: cappedTo,
		total,
		truncated: cappedTo < total,
		maxChars: options.maxChars,
	};
};

export const getViewport = (): CoAgentViewport => ({
	width: window.innerWidth,
	height: window.innerHeight,
	scrollX: window.scrollX,
	scrollY: window.scrollY,
	scrollWidth: document.documentElement.scrollWidth,
	scrollHeight: document.documentElement.scrollHeight,
});

export const rectToPayload = (rect: DOMRect): CoAgentRect => ({
	x: rect.left,
	y: rect.top,
	width: rect.width,
	height: rect.height,
});

export const isRectInViewport = (rect: DOMRect): boolean =>
	rect.width > 0 &&
	rect.height > 0 &&
	rect.bottom >= 0 &&
	rect.right >= 0 &&
	rect.top <= window.innerHeight &&
	rect.left <= window.innerWidth;

export const isElementVisible = (element: Element): boolean => {
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

export const acceptsTextInput = (element: Element): boolean => {
	if (element instanceof HTMLTextAreaElement) return true;
	if (!(element instanceof HTMLInputElement)) return false;
	const inputType = (element.type || "text").toLowerCase();
	return [
		"",
		"text",
		"search",
		"url",
		"number",
		"date",
		"datetime-local",
		"month",
		"time",
		"week",
	].includes(inputType);
};

const cssEscape = (value: string): string => {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/["\\#.:,[\]>+~*'=]/g, "\\$&");
};

const isUniqueSelector = (selector: string, element: Element): boolean => {
	try {
		const matches = document.querySelectorAll(selector);
		return matches.length === 1 && matches.item(0) === element;
	} catch {
		return false;
	}
};

export const buildStableSelector = (element: Element): string => {
	const tagName = element.tagName.toLowerCase();
	const id = element.getAttribute("id");
	if (id) {
		const selector = `#${cssEscape(id)}`;
		if (isUniqueSelector(selector, element)) return selector;
	}

	for (const attr of ["data-testid", "data-test", "name", "aria-label"]) {
		const value = element.getAttribute(attr);
		if (!value) continue;
		const selector = `${tagName}[${attr}="${cssEscape(value)}"]`;
		if (isUniqueSelector(selector, element)) return selector;
	}

	const parts: string[] = [];
	let current: Element | null = element;
	while (current && current !== document.documentElement && parts.length < 5) {
		const currentTag = current.tagName.toLowerCase();
		const currentTagName = current.tagName;
		const parent: Element | null = current.parentElement;
		if (!parent) break;
		const sameTagSiblings = Array.from(parent.children).filter(
			(child): child is Element =>
				child instanceof Element && child.tagName === currentTagName,
		);
		const index = sameTagSiblings.indexOf(current) + 1;
		parts.unshift(`${currentTag}:nth-of-type(${Math.max(index, 1)})`);
		const selector = parts.join(" > ");
		if (isUniqueSelector(selector, element)) return selector;
		current = parent;
	}

	return parts.length ? parts.join(" > ") : tagName;
};

export const createElementInfo = (
	element: Element,
	index: number,
	options: { maxTextChars?: number } = {},
): CoAgentElementInfo => {
	const rect = element.getBoundingClientRect();
	return {
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
		text: truncate(
			(element.textContent ?? "").trim(),
			options.maxTextChars ?? 1_000,
		),
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
		stableSelector: buildStableSelector(element),
		rect: rectToPayload(rect),
		images: getElementImages(element),
	};
};

export const getIndexedElement = (selector: string, index = 0): Element => {
	const element = document.querySelectorAll(selector).item(index);
	if (!(element instanceof Element)) {
		throw new Error(`No element at index ${index} for selector: ${selector}`);
	}
	return element;
};

const resolveUrl = (value: string | null): string | null => {
	if (!value?.trim()) return null;
	try {
		return new URL(value, window.location.href).href;
	} catch {
		return value;
	}
};

function getElementImages(element: Element, maxImages = 6): CoAgentImageInfo[] {
	const candidates =
		element instanceof HTMLImageElement
			? [element, ...Array.from(element.querySelectorAll("img"))]
			: Array.from(element.querySelectorAll("img"));
	const seen = new Set<string>();
	const images: CoAgentImageInfo[] = [];

	for (const image of candidates) {
		const src = resolveUrl(image.currentSrc || image.getAttribute("src"));
		if (!src || seen.has(src)) continue;
		seen.add(src);
		const rect = image.getBoundingClientRect();
		images.push({
			src,
			alt: image.getAttribute("alt"),
			title: image.getAttribute("title"),
			width: Math.round(rect.width || image.naturalWidth || 0),
			height: Math.round(rect.height || image.naturalHeight || 0),
		});
		if (images.length >= maxImages) break;
	}

	return images;
}

export const getVisibleText = (maxChars: number): string => {
	const body = document.body;
	if (!body) return "";
	const chunks: string[] = [];
	const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const text = node.textContent?.replace(/\s+/g, " ").trim();
			if (!text) return NodeFilter.FILTER_REJECT;
			const parent = node.parentElement;
			if (!parent || !isElementVisible(parent)) {
				return NodeFilter.FILTER_REJECT;
			}
			if (!isRectInViewport(parent.getBoundingClientRect())) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	while (walker.nextNode()) {
		const text = walker.currentNode.textContent?.replace(/\s+/g, " ").trim();
		if (!text) continue;
		chunks.push(text);
		if (chunks.join(" ").length >= maxChars) break;
	}

	return truncate(chunks.join(" "), maxChars);
};

export const getDomSummary = (maxElements: number): CoAgentElementInfo[] => {
	const selector = [
		"a",
		"button",
		"input",
		"textarea",
		"select",
		"[role='button']",
		"[role='link']",
		"h1",
		"h2",
		"h3",
		"main",
		"article",
		"section",
		"p",
		"li",
	].join(",");

	return Array.from(document.querySelectorAll(selector))
		.filter((element) => element instanceof Element)
		.filter((element) => isRectInViewport(element.getBoundingClientRect()))
		.slice(0, maxElements)
		.map((element, index) => createElementInfo(element, index));
};

export const buildSnapshot = (
	options: {
		includePageText?: boolean;
		includeVisibleText?: boolean;
		includeDomSummary?: boolean;
		maxTextChars?: number;
		maxVisibleTextChars?: number;
		textStart?: number;
		maxDomElements?: number;
	} = {},
): CoAgentPageSnapshot => {
	const snapshot: CoAgentPageSnapshot = {
		url: window.location.href,
		title: document.title || "",
		viewport: getViewport(),
	};
	if (options.includeVisibleText) {
		snapshot.visibleText = getVisibleText(
			options.maxVisibleTextChars ?? DEFAULT_VISIBLE_TEXT_MAX_CHARS,
		);
	}
	if (options.includePageText) {
		const fullText =
			document.body?.innerText || document.documentElement?.textContent || "";
		const maxChars = options.maxTextChars ?? DEFAULT_TEXT_MAX_CHARS;
		const range = normalizeTextRange(fullText.length, {
			textStart: options.textStart,
			maxChars,
		});
		snapshot.text = fullText.slice(range.from, range.to);
		snapshot.textRange = range;
	}
	if (
		options.includeDomSummary &&
		options.maxDomElements &&
		options.maxDomElements > 0
	) {
		snapshot.domSummary = getDomSummary(options.maxDomElements);
	}
	return snapshot;
};

export const queryElements = (
	selector: string,
	maxResults = 20,
): CoAgentElementInfo[] =>
	Array.from(document.querySelectorAll(selector))
		.filter((node): node is Element => node instanceof Element)
		.slice(0, Math.max(1, Math.min(50, maxResults)))
		.map((element, index) => createElementInfo(element, index));

const getScrollableTarget = (
	selector: string | undefined,
	index: number | undefined,
): Window | HTMLElement => {
	if (!selector) return window;
	const element = getIndexedElement(selector, index);
	if (!(element instanceof HTMLElement)) {
		throw new Error("Selected element cannot be scrolled.");
	}
	return element;
};

export const scrollTarget = (
	selector: string | undefined,
	index: number | undefined,
	options: {
		behavior?: ScrollBehavior;
		deltaX?: number;
		deltaY?: number;
		left?: number;
		top?: number;
	},
): void => {
	const target = getScrollableTarget(selector, index);
	const behavior = options.behavior ?? "smooth";
	if ("scrollBy" in target && (options.deltaX || options.deltaY)) {
		target.scrollBy({
			left: options.deltaX ?? 0,
			top: options.deltaY ?? 0,
			behavior,
		});
		return;
	}
	target.scrollTo({
		left: options.left,
		top: options.top,
		behavior,
	});
};

export const setNativeTextValue = (
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): void => {
	const prototype =
		element instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
	if (descriptor?.set) {
		descriptor.set.call(element, value);
	} else {
		element.value = value;
	}
};

export const getPageDescription = (): string => {
	const selectors = [
		'meta[name="description"]',
		'meta[property="og:description"]',
		'meta[name="twitter:description"]',
	];
	for (const selector of selectors) {
		const value = document.querySelector(selector)?.getAttribute("content");
		if (value?.trim()) return value.trim();
	}
	return getVisibleText(700);
};

const getSensitiveAttributeText = (element: Element): string =>
	[
		element.getAttribute("type"),
		element.getAttribute("name"),
		element.getAttribute("id"),
		element.getAttribute("placeholder"),
		element.getAttribute("aria-label"),
		element.getAttribute("autocomplete"),
		element.getAttribute("title"),
		(element.textContent ?? "").slice(0, 120),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

const SENSITIVE_INPUT_PATTERN =
	/(password|passcode|otp|token|secret|credential|credit|card|cc-|cvc|cvv|ssn|social security|email|phone|tel|address|birth|dob|auth|login|sign in|signin)/i;
const UNSAFE_CLICK_PATTERN =
	/(delete|remove|destroy|clear|reset|submit|send|pay|purchase|buy|checkout|subscribe|unsubscribe|sign in|signin|log in|login|logout|upload|confirm|apply|book|reserve|cancel|password|account|security|permission|allow)/i;

/**
 * Whose page the co-agent is acting on.
 *
 * `third-party` is a stranger's page: the agent cannot know what any button
 * does, so the blocklist above is deliberately broad and blocks anything that
 * reads destructive or transactional.
 *
 * `first-party` is Memorall's own UI. That same list would block almost every
 * action a user would actually ask an in-app co-pilot to take — "delete this
 * note", "clear this topic" — while adding little safety, because the user
 * already trusts Memorall with this data and every screen is undoable or
 * confirmed. So the pattern narrows to the genuinely irreversible affordances,
 * and any component can opt a subtree back out with
 * `data-memorall-coagent="deny"`.
 */
export type CoAgentSafetyPolicy = "third-party" | "first-party";

const FIRST_PARTY_UNSAFE_CLICK_PATTERN =
	/(pay|purchase|buy|checkout|subscribe|password|credential|api[ _-]?key|secret|token|security|permission|allow)/i;

const DENY_ATTRIBUTE_SELECTOR = '[data-memorall-coagent="deny"]';

export const assertSafeTextInput = (
	element: Element,
	policy: CoAgentSafetyPolicy = "third-party",
): void => {
	if (element.closest(DENY_ATTRIBUTE_SELECTOR)) {
		throw new Error(
			"This field is marked off limits. User action is required.",
		);
	}
	if (!acceptsTextInput(element)) {
		throw new Error("Target element does not support safe text input.");
	}
	const attrText = getSensitiveAttributeText(element);
	if (SENSITIVE_INPUT_PATTERN.test(attrText)) {
		throw new Error(
			"This input may request sensitive information. User action is required.",
		);
	}
};

export const assertSafeClickTarget = (
	element: Element,
	policy: CoAgentSafetyPolicy = "third-party",
): void => {
	if (!(element instanceof HTMLElement)) {
		throw new Error("Target element cannot be clicked safely.");
	}
	if (element.closest(DENY_ATTRIBUTE_SELECTOR)) {
		throw new Error(
			"This control is marked off limits. User action is required.",
		);
	}
	if (
		(element instanceof HTMLButtonElement ||
			element instanceof HTMLInputElement) &&
		element.disabled
	) {
		throw new Error("Target element is disabled.");
	}
	if (element instanceof HTMLInputElement) {
		const inputType = (element.type || "text").toLowerCase();
		if (
			["password", "file", "hidden", "submit", "reset", "image"].includes(
				inputType,
			)
		) {
			throw new Error(
				"This click may submit or expose sensitive data. User action is required.",
			);
		}
	}
	if (
		element instanceof HTMLButtonElement &&
		(element.type || "submit").toLowerCase() === "submit"
	) {
		throw new Error("Form submission requires user action.");
	}
	const unsafeClick =
		policy === "first-party"
			? FIRST_PARTY_UNSAFE_CLICK_PATTERN
			: UNSAFE_CLICK_PATTERN;
	if (unsafeClick.test(getSensitiveAttributeText(element))) {
		throw new Error("This click looks high impact. User action is required.");
	}
};
