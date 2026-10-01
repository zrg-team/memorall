/**
 * Page outline: the text-first view of a page that MemonOS Bot reads and draws.
 *
 * One walk over the visible DOM produces ordered blocks — headings, text,
 * list items, quotes — and gives every link, control and image a short ref
 * (`b4`). Refs are stable per element for the life of the document, so an
 * outline taken after a scroll or an input keeps the same refs, and every
 * action carries the `docToken` it was read with: a ref from an older
 * document fails as a stale screen instead of clicking whatever now sits at
 * that index.
 *
 * Everything takes a `Document` and uses its own `defaultView` and tag names
 * rather than globals and `instanceof`, so the same code runs in the content
 * script, on an offscreen iframe document, and in the desktop page bundle.
 * State lives on the document's window (`__memorallOutline`), which a
 * re-injected second copy of the content script shares.
 */

export type PageOutlineBlock =
	| {
			kind: "heading";
			level: 1 | 2 | 3;
			text: string;
			ref?: string;
			href?: string;
	  }
	| { kind: "text"; text: string }
	| { kind: "list"; items: string[] }
	| { kind: "quote"; text: string }
	| { kind: "link"; ref: string; text: string; href: string }
	| { kind: "button"; ref: string; text: string; submits: boolean }
	| {
			kind: "input";
			ref: string;
			inputType: string;
			label: string;
			value: string;
			placeholder?: string;
	  }
	| {
			kind: "select";
			ref: string;
			label: string;
			value: string;
			options: string[];
	  }
	| {
			kind: "image";
			ref: string;
			alt: string;
			width: number;
			height: number;
			src?: string;
	  };

export interface PageOutline {
	url: string;
	title: string;
	docToken: string;
	blocks: PageOutlineBlock[];
	/** Blocks before `blocks[0]` that were left out to fit the budget. */
	omittedAbove: number;
	/** Blocks after the last one that were left out to fit the budget. */
	omittedBelow: number;
	scroll: { y: number; viewportHeight: number; pageHeight: number };
}

export interface BuildPageOutlineOptions {
	/** Character budget for the formatted outline. */
	maxChars?: number;
}

export type PageOutlineAction =
	| "click"
	| "input"
	| "focus"
	| "submit"
	| "scrollScreen"
	| "describe";

export interface PageOutlineActionRequest {
	ref?: string;
	docToken?: string;
	action: PageOutlineAction;
	value?: string;
	/** Allows POST form submissions; otherwise they return `needsApproval`. */
	allowFormSubmit?: boolean;
}

export type PageOutlineActionResult =
	| { ok: true; action: PageOutlineAction; ref?: string; detail?: string }
	| {
			ok: false;
			action: PageOutlineAction;
			ref?: string;
			needsApproval: "form-submit";
			detail: string;
	  };

export class StaleOutlineError extends Error {
	constructor(
		message = "The page changed since the last screen. Read the screen again and use the new refs.",
	) {
		super(message);
		this.name = "StaleOutlineError";
	}
}

const DEFAULT_MAX_CHARS = 8_000;
const MAX_TEXT_CHARS = 600;
const MAX_LABEL_CHARS = 120;
const MAX_VISITED_ELEMENTS = 20_000;
const MIN_IMAGE_SIZE = 24;

const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"template",
	"head",
	"meta",
	"link",
	"iframe",
	"frame",
	"object",
	"embed",
	"canvas",
	"svg",
	"math",
]);
const TEXT_CONTAINER_TAGS = new Set([
	"p",
	"pre",
	"figcaption",
	"dd",
	"dt",
	"td",
	"th",
	"caption",
	"label",
	"legend",
]);
const TEXT_INPUT_TYPES = new Set([
	"",
	"text",
	"search",
	"url",
	"email",
	"tel",
	"number",
	"date",
	"datetime-local",
	"month",
	"time",
	"week",
]);
const BLOCKED_INPUT_TYPES = new Set(["password", "file", "hidden"]);
const SENSITIVE_FIELD_PATTERN =
	/(password|passcode|otp|one[- ]?time|token|secret|credential|credit|card[- ]?number|cc-|cvc|cvv|ssn|social security)/i;
const DENY_SELECTOR = '[data-memorall-coagent="deny"]';

interface OutlineState {
	token: string;
	counter: number;
	refs: WeakMap<Element, string>;
	byRef: Map<string, WeakRef<Element>>;
}

type OutlineWindow = Window & {
	__memorallOutline?: WeakMap<Document, OutlineState>;
};

const randomToken = (): string =>
	`d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const getState = (doc: Document): OutlineState => {
	const view = (doc.defaultView ?? globalThis) as unknown as OutlineWindow;
	if (!view.__memorallOutline) view.__memorallOutline = new WeakMap();
	let state = view.__memorallOutline.get(doc);
	if (!state) {
		state = {
			token: randomToken(),
			counter: 0,
			refs: new WeakMap(),
			byRef: new Map(),
		};
		view.__memorallOutline.set(doc, state);
	}
	return state;
};

const refFor = (state: OutlineState, element: Element): string => {
	const existing = state.refs.get(element);
	if (existing) return existing;
	state.counter += 1;
	const ref = `b${state.counter}`;
	state.refs.set(element, ref);
	state.byRef.set(ref, new WeakRef(element));
	return ref;
};

const clean = (value: string | null | undefined, max: number): string => {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const tagOf = (element: Element): string => element.localName.toLowerCase();

const isVisible = (element: Element, view: Window): boolean => {
	if (element.hasAttribute("hidden")) return false;
	if (element.getAttribute("aria-hidden") === "true") return false;
	const style = view.getComputedStyle(element);
	if (style.display === "none" || style.visibility === "hidden") return false;
	return element.getClientRects().length > 0;
};

const isInteractive = (element: Element): boolean => {
	const tag = tagOf(element);
	if (tag === "a") return element.hasAttribute("href");
	if (
		tag === "button" ||
		tag === "textarea" ||
		tag === "select" ||
		tag === "summary"
	)
		return true;
	if (tag === "input") {
		// Password fields are listed (so the agent knows to ask) but never filled.
		const type = (element.getAttribute("type") ?? "").toLowerCase();
		return type !== "hidden" && type !== "file";
	}
	const role = element.getAttribute("role");
	return (
		role === "button" ||
		role === "link" ||
		role === "tab" ||
		role === "menuitem"
	);
};

const hasInteractiveDescendant = (element: Element): boolean =>
	Boolean(
		element.querySelector(
			'a[href],button,input,textarea,select,summary,[role="button"],[role="link"]',
		),
	);

const accessibleLabel = (element: Element): string => {
	const aria = element.getAttribute("aria-label");
	if (aria?.trim()) return clean(aria, MAX_LABEL_CHARS);
	const labelledBy = element.getAttribute("aria-labelledby");
	if (labelledBy) {
		const text = labelledBy
			.split(/\s+/)
			.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
			.join(" ");
		if (text.trim()) return clean(text, MAX_LABEL_CHARS);
	}
	const labels = (element as HTMLInputElement).labels;
	if (labels?.length) {
		const text = Array.from(labels, (label) => label.textContent ?? "").join(
			" ",
		);
		if (text.trim()) return clean(text, MAX_LABEL_CHARS);
	}
	return clean(
		element.getAttribute("title") ?? element.getAttribute("name"),
		MAX_LABEL_CHARS,
	);
};

const elementText = (element: Element): string => {
	const text = clean(element.textContent, MAX_LABEL_CHARS);
	if (text) return text;
	const img = element.querySelector("img[alt]");
	return (
		accessibleLabel(element) || clean(img?.getAttribute("alt"), MAX_LABEL_CHARS)
	);
};

/** Mirrors readable-text's summary: a data URL is the image, not a link to it. */
const imageSource = (element: Element): string | undefined => {
	const raw =
		element.getAttribute("src") ??
		element.getAttribute("data-src") ??
		element.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
	if (!raw) return undefined;
	if (raw.startsWith("data:")) {
		const end = raw.indexOf(";");
		const mime = raw.slice(5, end >= 0 ? end : 5);
		return `data:${mime || "unknown"} (inline, ~${Math.round(raw.length / 1024)} KB — not fetchable)`;
	}
	try {
		return new URL(raw, element.ownerDocument.baseURI).href;
	} catch {
		return raw;
	}
};

const formOf = (element: Element): HTMLFormElement | null =>
	((element as HTMLButtonElement).form ??
		element.closest("form")) as HTMLFormElement | null;

const isPostForm = (form: HTMLFormElement | null): boolean =>
	Boolean(
		form && (form.getAttribute("method") ?? "get").toLowerCase() === "post",
	);

/** A click that would send a POST form. GET forms (searches) navigate. */
const clickSubmitsPostForm = (element: Element): boolean => {
	const tag = tagOf(element);
	const type = (
		element.getAttribute("type") ?? (tag === "button" ? "submit" : "")
	).toLowerCase();
	const submits =
		(tag === "button" && type === "submit") ||
		(tag === "input" && (type === "submit" || type === "image"));
	return submits && isPostForm(formOf(element));
};

interface Collected {
	block: PageOutlineBlock;
	top: number;
}

const interactiveBlock = (
	element: Element,
	state: OutlineState,
): PageOutlineBlock | null => {
	const tag = tagOf(element);
	const ref = refFor(state, element);
	if (tag === "a" || element.getAttribute("role") === "link") {
		const href =
			(element as HTMLAnchorElement).href || element.getAttribute("href") || "";
		return { kind: "link", ref, text: elementText(element) || href, href };
	}
	if (tag === "input" || tag === "textarea") {
		const inputType =
			tag === "textarea"
				? "textarea"
				: (element.getAttribute("type") ?? "text").toLowerCase();
		if (["button", "submit", "reset", "image"].includes(inputType)) {
			return {
				kind: "button",
				ref,
				text:
					clean((element as HTMLInputElement).value, MAX_LABEL_CHARS) ||
					accessibleLabel(element) ||
					inputType,
				submits: clickSubmitsPostForm(element),
			};
		}
		const sensitive =
			inputType === "password" ||
			SENSITIVE_FIELD_PATTERN.test(
				`${element.getAttribute("name") ?? ""} ${element.getAttribute("autocomplete") ?? ""}`,
			);
		return {
			kind: "input",
			ref,
			inputType,
			label: accessibleLabel(element),
			value: sensitive
				? ""
				: clean((element as HTMLInputElement).value, MAX_LABEL_CHARS),
			placeholder:
				clean(element.getAttribute("placeholder"), MAX_LABEL_CHARS) ||
				undefined,
		};
	}
	if (tag === "select") {
		const select = element as HTMLSelectElement;
		const options = Array.from(select.options, (option) =>
			clean(option.textContent, 40),
		).filter(Boolean);
		return {
			kind: "select",
			ref,
			label: accessibleLabel(element),
			value: clean(select.selectedOptions?.[0]?.textContent, 60),
			options: options.slice(0, 8),
		};
	}
	return {
		kind: "button",
		ref,
		text: elementText(element) || "button",
		submits: clickSubmitsPostForm(element),
	};
};

const collectBlocks = (doc: Document, state: OutlineState): Collected[] => {
	const view = doc.defaultView;
	const out: Collected[] = [];
	const root = doc.body ?? doc.documentElement;
	if (!root || !view) return out;
	const scrollY = view.scrollY || 0;
	let visited = 0;

	const topOf = (element: Element): number =>
		element.getBoundingClientRect().top + scrollY;
	const push = (block: PageOutlineBlock, element: Element) => {
		const last = out[out.length - 1]?.block;
		if (block.kind === "text" && last?.kind === "text") {
			last.text = clean(`${last.text} ${block.text}`, MAX_TEXT_CHARS);
			return;
		}
		if (block.kind === "list" && last?.kind === "list") {
			last.items.push(...block.items);
			return;
		}
		out.push({ block, top: topOf(element) });
	};

	const walk = (element: Element): void => {
		if (visited++ > MAX_VISITED_ELEMENTS) return;
		const tag = tagOf(element);
		if (SKIP_TAGS.has(tag)) return;
		if (!isVisible(element, view)) return;

		if (isInteractive(element)) {
			const block = interactiveBlock(element, state);
			if (block) push(block, element);
			return;
		}
		if (tag === "img") {
			const rect = element.getBoundingClientRect();
			const width = Math.round(
				rect.width || (element as HTMLImageElement).naturalWidth || 0,
			);
			const height = Math.round(
				rect.height || (element as HTMLImageElement).naturalHeight || 0,
			);
			const alt = clean(element.getAttribute("alt"), MAX_LABEL_CHARS);
			if ((width >= MIN_IMAGE_SIZE && height >= MIN_IMAGE_SIZE) || alt) {
				push(
					{
						kind: "image",
						ref: refFor(state, element),
						alt,
						width,
						height,
						src: imageSource(element),
					},
					element,
				);
			}
			return;
		}
		const headingLevel = /^h([1-6])$/.exec(tag)?.[1];
		if (headingLevel) {
			const text = clean(element.textContent, MAX_LABEL_CHARS);
			if (!text) return;
			const links = element.querySelectorAll("a[href]");
			const level = Math.min(Number(headingLevel), 3) as 1 | 2 | 3;
			if (links.length === 1) {
				const link = links[0] as HTMLAnchorElement;
				push(
					{
						kind: "heading",
						level,
						text,
						ref: refFor(state, link),
						href: link.href,
					},
					element,
				);
			} else {
				push({ kind: "heading", level, text }, element);
				for (const link of Array.from(links)) walk(link);
			}
			return;
		}
		if (tag === "li") {
			if (!hasInteractiveDescendant(element)) {
				const text = clean(element.textContent, MAX_TEXT_CHARS);
				if (text) push({ kind: "list", items: [text] }, element);
				return;
			}
		}
		if (tag === "blockquote") {
			const text = clean(element.textContent, MAX_TEXT_CHARS);
			if (text) push({ kind: "quote", text }, element);
			if (!hasInteractiveDescendant(element)) return;
		}
		if (TEXT_CONTAINER_TAGS.has(tag) && tag !== "label") {
			const text = clean(element.textContent, MAX_TEXT_CHARS);
			if (text) push({ kind: "text", text }, element);
			if (!hasInteractiveDescendant(element)) return;
			for (const child of Array.from(
				element.querySelectorAll(
					'a[href],button,input,textarea,select,[role="button"],[role="link"],img',
				),
			)) {
				walk(child);
			}
			return;
		}
		for (const node of Array.from(element.childNodes)) {
			if (node.nodeType === 3) {
				const text = clean(node.textContent, MAX_TEXT_CHARS);
				if (text) push({ kind: "text", text }, element);
			} else if (node.nodeType === 1) {
				walk(node as Element);
			}
		}
	};

	walk(root);
	return out;
};

const shortHref = (href: string): string =>
	clean(href.replace(/^https?:\/\//, "").replace(/\/$/, ""), 90);

const quote = (value: string): string => `"${value.replace(/"/g, "'")}"`;

export const formatOutlineBlock = (block: PageOutlineBlock): string => {
	switch (block.kind) {
		case "heading": {
			const marks = "#".repeat(block.level);
			return block.ref
				? `${marks} [${block.ref}] ${block.text} → ${shortHref(block.href ?? "")}`
				: `${marks} ${block.text}`;
		}
		case "text":
			return block.text;
		case "list":
			return block.items.map((item) => `- ${item}`).join("\n");
		case "quote":
			return `> ${block.text}`;
		case "link":
			return `[${block.ref}] link ${quote(block.text)} → ${shortHref(block.href)}`;
		case "button":
			return `[${block.ref}] button ${quote(block.text)}${block.submits ? " (submits a form)" : ""}`;
		case "input": {
			const parts = [
				`[${block.ref}] input`,
				block.inputType === "text" ? "" : block.inputType,
				block.label ? quote(block.label) : "",
			];
			if (block.value) parts.push(`value=${quote(block.value)}`);
			else if (block.placeholder)
				parts.push(`placeholder=${quote(block.placeholder)}`);
			return parts.filter(Boolean).join(" ");
		}
		case "select":
			return `[${block.ref}] select ${quote(block.label)} value=${quote(block.value)} options: ${block.options.join(" | ")}`;
		case "image":
			return `[${block.ref}] img ${block.width}×${block.height} ${quote(block.alt || "no alt text")}`;
	}
};

/** The model-facing text for an outline, including omitted-block markers. */
export const formatPageOutline = (
	outline: Pick<PageOutline, "blocks" | "omittedAbove" | "omittedBelow">,
): string => {
	const lines: string[] = [];
	if (outline.omittedAbove > 0)
		lines.push(
			`(… ${outline.omittedAbove} blocks above — scroll up to read them)`,
		);
	for (const block of outline.blocks) lines.push(formatOutlineBlock(block));
	if (outline.omittedBelow > 0)
		lines.push(
			`(… ${outline.omittedBelow} more blocks below — scroll down to read them)`,
		);
	return lines.join("\n");
};

/**
 * Builds the outline. When the page does not fit the budget, the window of
 * blocks starts a little above the current viewport, so scrolling moves the
 * outline with the reader.
 */
export const buildPageOutline = (
	doc: Document,
	options: BuildPageOutlineOptions = {},
): PageOutline => {
	const state = getState(doc);
	const view = doc.defaultView;
	const collected = collectBlocks(doc, state);
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const viewportHeight = view?.innerHeight ?? 0;
	const scrollY = view?.scrollY ?? 0;

	const sizes = collected.map(
		({ block }) => formatOutlineBlock(block).length + 1,
	);
	const total = sizes.reduce((sum, size) => sum + size, 0);
	let start = 0;
	let end = collected.length;
	if (total > maxChars) {
		const anchor = scrollY - viewportHeight * 0.25;
		start = Math.max(
			0,
			collected.findIndex(({ top }) => top >= anchor),
		);
		if (start < 0) start = 0;
		let used = 0;
		end = start;
		while (end < collected.length && used + sizes[end] <= maxChars) {
			used += sizes[end];
			end += 1;
		}
		if (end === start && start < collected.length) end = start + 1;
	}

	return {
		url: doc.location?.href ?? doc.URL,
		title: clean(doc.title, 200),
		docToken: state.token,
		blocks: collected.slice(start, end).map(({ block }) => block),
		omittedAbove: start,
		omittedBelow: collected.length - end,
		scroll: {
			y: Math.round(scrollY),
			viewportHeight: Math.round(viewportHeight),
			pageHeight: Math.round(doc.documentElement?.scrollHeight ?? 0),
		},
	};
};

const resolveRef = (
	doc: Document,
	ref: string | undefined,
	docToken: string | undefined,
): Element => {
	const state = getState(doc);
	if (docToken && docToken !== state.token) throw new StaleOutlineError();
	if (!ref)
		throw new Error("This action needs a ref from the screen, like b4.");
	const element = state.byRef.get(ref)?.deref();
	if (!element || !element.isConnected) {
		throw new StaleOutlineError(
			`${ref} is no longer on the page. Read the screen again and use the new refs.`,
		);
	}
	return element;
};

const assertActionable = (element: Element): void => {
	if (element.closest(DENY_SELECTOR)) {
		throw new Error(
			"This control is marked off limits. The user has to do this.",
		);
	}
	if ((element as HTMLButtonElement).disabled)
		throw new Error("That control is disabled.");
};

/** Sets a value through the element's own prototype so frameworks see it. */
const setNativeValue = (
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): void => {
	let proto: object | null = Object.getPrototypeOf(element);
	while (proto) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
		if (descriptor?.set) {
			descriptor.set.call(element, value);
			return;
		}
		proto = Object.getPrototypeOf(proto);
	}
	element.value = value;
};

const dispatch = (
	element: Element,
	type: string,
	init: EventInit = { bubbles: true },
): void => {
	const view = element.ownerDocument.defaultView;
	const EventCtor =
		(view as unknown as { Event: typeof Event } | null)?.Event ?? Event;
	element.dispatchEvent(new EventCtor(type, init));
};

const pressEnter = (element: Element): void => {
	const view = element.ownerDocument.defaultView as unknown as {
		KeyboardEvent: typeof KeyboardEvent;
	} | null;
	const KeyCtor = view?.KeyboardEvent ?? KeyboardEvent;
	for (const type of ["keydown", "keypress", "keyup"]) {
		element.dispatchEvent(
			new KeyCtor(type, {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	}
};

export const actOnRef = (
	doc: Document,
	request: PageOutlineActionRequest,
): PageOutlineActionResult => {
	const { action } = request;
	if (action === "scrollScreen") {
		const view = doc.defaultView;
		const direction = request.value === "up" ? -1 : 1;
		view?.scrollBy({
			top: direction * Math.round((view.innerHeight || 600) * 0.85),
			behavior: "instant" as ScrollBehavior,
		});
		return { ok: true, action };
	}

	const element = resolveRef(doc, request.ref, request.docToken);
	const ref = request.ref;
	assertActionable(element);
	const tag = tagOf(element);

	if (action === "describe") {
		if (tag !== "img") throw new Error(`${ref} is not an image.`);
		return { ok: true, action, ref, detail: imageSource(element) ?? "" };
	}
	if (action === "focus") {
		(element as HTMLElement).focus?.();
		return { ok: true, action, ref };
	}
	if (action === "click") {
		const type = (element.getAttribute("type") ?? "").toLowerCase();
		if (tag === "input" && BLOCKED_INPUT_TYPES.has(type)) {
			throw new Error("That field needs the user.");
		}
		if (clickSubmitsPostForm(element) && !request.allowFormSubmit) {
			return {
				ok: false,
				action,
				ref,
				needsApproval: "form-submit",
				detail: "This click submits a form.",
			};
		}
		(element as HTMLElement).scrollIntoView?.({ block: "center" });
		(element as HTMLElement).click();
		return { ok: true, action, ref };
	}
	if (action === "input" || action === "submit") {
		if (tag === "select" && action === "input") {
			const select = element as HTMLSelectElement;
			const wanted = (request.value ?? "").trim().toLowerCase();
			const option = Array.from(select.options).find(
				(candidate) =>
					candidate.value.toLowerCase() === wanted ||
					clean(candidate.textContent, 200).toLowerCase() === wanted,
			);
			if (!option) throw new Error(`No option "${request.value}" in ${ref}.`);
			select.value = option.value;
			dispatch(select, "input");
			dispatch(select, "change");
			return { ok: true, action, ref };
		}
		const isTextArea = tag === "textarea";
		const type = (element.getAttribute("type") ?? "text").toLowerCase();
		if (!isTextArea && !(tag === "input" && TEXT_INPUT_TYPES.has(type))) {
			throw new Error(`${ref} does not take text.`);
		}
		if (
			SENSITIVE_FIELD_PATTERN.test(
				`${element.getAttribute("name") ?? ""} ${element.getAttribute("autocomplete") ?? ""} ${accessibleLabel(element)}`,
			)
		) {
			throw new Error(
				"That field asks for sensitive information. The user has to fill it.",
			);
		}
		const field = element as HTMLInputElement | HTMLTextAreaElement;
		if (request.value !== undefined) {
			field.focus?.();
			setNativeValue(field, request.value);
			dispatch(field, "input");
			dispatch(field, "change");
		}
		if (action === "submit") {
			const form = formOf(field);
			if (isPostForm(form) && !request.allowFormSubmit) {
				return {
					ok: false,
					action,
					ref,
					needsApproval: "form-submit",
					detail: "Pressing Enter here submits a form.",
				};
			}
			if (form && typeof form.requestSubmit === "function")
				form.requestSubmit();
			else pressEnter(field);
		}
		return { ok: true, action, ref };
	}
	throw new Error(`Unknown action ${action}.`);
};

/** Drops ref state for a document, e.g. before a tab is reused. */
export const resetPageOutline = (doc: Document): void => {
	const view = doc.defaultView as OutlineWindow | null;
	view?.__memorallOutline?.delete(doc);
};
