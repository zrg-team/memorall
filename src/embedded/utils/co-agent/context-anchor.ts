import type { CoAgentRect } from "@/services/co-agent";
import {
	buildStableSelector,
	createElementInfo,
	isElementVisible,
	isRectInViewport,
	rectToPayload,
	truncate,
} from "./dom-utils";

export interface CoAgentContextAnchor {
	kind: "hover" | "focus" | "selection" | "shortcut";
	selector?: string;
	index?: number;
	rect: CoAgentRect;
	uiPoint?: { x: number; y: number };
	tagName: string;
	text: string;
	value: string | null;
	ariaLabel: string | null;
	placeholder: string | null;
	href: string | null;
	nearbyText: string;
	createdAt: number;
	isStale?: boolean;
}

export const isEditableElement = (element: Element | null): boolean =>
	element instanceof HTMLInputElement ||
	element instanceof HTMLTextAreaElement ||
	element instanceof HTMLSelectElement ||
	(element instanceof HTMLElement && element.isContentEditable);

const getSelectorIndex = (selector: string, element: Element): number => {
	try {
		return Math.max(
			0,
			Array.from(document.querySelectorAll(selector)).indexOf(element),
		);
	} catch {
		return 0;
	}
};

const getNearbyText = (element: Element, maxChars = 1_200): string => {
	const container =
		element.closest(
			"article, main, section, form, fieldset, li, tr, td, th, [role='article'], [role='listitem'], [role='group']",
		) ||
		element.closest("div") ||
		element;
	return truncate(
		(container.textContent ?? "").replace(/\s+/g, " ").trim(),
		maxChars,
	);
};

export const createContextAnchor = (
	element: Element,
	kind: CoAgentContextAnchor["kind"],
): CoAgentContextAnchor | null => {
	if (!(element instanceof HTMLElement) || !isElementVisible(element))
		return null;
	const info = createElementInfo(element, 0);
	const selector = info.stableSelector;
	return {
		kind,
		selector,
		index: getSelectorIndex(selector, element),
		rect: info.rect,
		tagName: info.tagName,
		text: info.text,
		value: info.value,
		ariaLabel: info.ariaLabel,
		placeholder: info.placeholder,
		href: info.href,
		nearbyText: getNearbyText(element),
		createdAt: Date.now(),
	};
};

export const createSelectionAnchor = (): CoAgentContextAnchor | null => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	const text = selection.toString().replace(/\s+/g, " ").trim();
	if (!text) return null;
	const range = selection.getRangeAt(0);
	const rect = range.getBoundingClientRect();
	if (!isRectInViewport(rect)) return null;
	const container =
		range.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range.commonAncestorContainer.parentElement;
	if (!container) return null;
	const element =
		container.closest(
			"a, button, input, textarea, select, article, main, section, p, li, td, th, div",
		) ?? container;
	const selector =
		element instanceof HTMLElement ? buildStableSelector(element) : undefined;
	return {
		kind: "selection",
		selector,
		index: selector ? getSelectorIndex(selector, element) : undefined,
		rect: rectToPayload(rect),
		tagName: element.tagName.toLowerCase(),
		text: truncate(text, 1_000),
		value: null,
		ariaLabel:
			element.getAttribute("aria-label") ||
			element.getAttribute("aria-labelledby"),
		placeholder: element.getAttribute("placeholder"),
		href:
			element instanceof HTMLAnchorElement
				? element.getAttribute("href")
				: null,
		nearbyText: getNearbyText(element),
		createdAt: Date.now(),
	};
};

export const refreshContextAnchor = (
	anchor: CoAgentContextAnchor,
): CoAgentContextAnchor => {
	if (!anchor.selector) return anchor;
	const element = document
		.querySelectorAll(anchor.selector)
		.item(anchor.index ?? 0);
	if (!(element instanceof HTMLElement) || !isElementVisible(element)) {
		return { ...anchor, isStale: true };
	}
	const rect = element.getBoundingClientRect();
	return {
		...anchor,
		rect: rectToPayload(rect),
		isStale: !isRectInViewport(rect),
	};
};

const truncateLabel = (value: string, max: number): string => {
	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed.length <= max) return collapsed;
	return `${collapsed.slice(0, max - 1)}…`;
};

/**
 * Short human description of an anchored element, for the "attached" chip.
 * The user needs to recognise which thing on the page is riding along with the
 * prompt, so prefer whatever a person would have read: its label, then its text.
 */
export const describeContextAnchor = (anchor: CoAgentContextAnchor): string => {
	const tag = (anchor.tagName || "element").toLowerCase();
	const detail =
		anchor.ariaLabel?.trim() ||
		anchor.text?.trim() ||
		anchor.value?.trim() ||
		anchor.placeholder?.trim() ||
		anchor.href?.trim() ||
		"";

	return detail ? `${tag} · ${truncateLabel(detail, 42)}` : tag;
};
