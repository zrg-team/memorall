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
	| {
			kind: "button";
			ref: string;
			text: string;
			submits: boolean;
			/** The page's own role for it when it is not a plain button: "checkbox", "tab", "option"… */
			role?: string;
			/** "checked", "unchecked", "expanded", "collapsed", "selected" or "pressed". */
			state?: string;
	  }
	| {
			kind: "input";
			ref: string;
			inputType: string;
			label: string;
			value: string;
			placeholder?: string;
			/** Checkboxes and radio buttons: whether it is checked. */
			checked?: boolean;
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
	  }
	| {
			/** A surface used by position (a canvas, a video): click it at x, y. */
			kind: "region";
			ref: string;
			tag: string;
			label: string;
			width: number;
			height: number;
			/** Its top-left corner in the viewport, in CSS pixels. */
			x: number;
			y: number;
	  };

export interface PageOutline {
	url: string;
	title: string;
	docToken: string;
	blocks: PageOutlineBlock[];
	/** Blocks scrolled past that were left out to fit the budget. */
	omittedAbove: number;
	/** Blocks below the screen that were left out to fit the budget. */
	omittedBelow: number;
	/**
	 * How far the page is scrolled: the document, or, when only an area of
	 * it scrolls (an app's main pane), that area.
	 */
	scroll: {
		y: number;
		viewportHeight: number;
		/** The viewport plus all there is to scroll. */
		pageHeight: number;
		/** The viewport's width, for positions; absent from older pages. */
		viewportWidth?: number;
	};
	/**
	 * The page says it is still loading: its document is still parsing, or it
	 * shows a busy region or a progress bar without a value. A page read until
	 * it holds still is also busy when the wait ran out before it did.
	 */
	busy?: boolean;
}

export interface BuildPageOutlineOptions {
	/** Character budget for the formatted outline. */
	maxChars?: number;
}

export type PageOutlineAction =
	| "click"
	| "hover"
	| "press"
	| "toggle"
	| "input"
	| "focus"
	| "submit"
	| "scrollScreen"
	| "describe";

export interface PageOutlineActionRequest {
	ref?: string;
	docToken?: string;
	action: PageOutlineAction;
	/**
	 * input/submit: the text. press: the key ("Enter", "Escape", "Control+a").
	 * toggle: "on" or "off" (flips without it). scrollScreen: up, down, left,
	 * right, top or bottom.
	 */
	value?: string;
	/**
	 * click/hover: a point in CSS pixels, from the top-left corner of `ref`,
	 * or of the viewport when there is no ref.
	 */
	x?: number;
	y?: number;
	/** Allows POST form submissions; otherwise they return `needsApproval`. */
	allowFormSubmit?: boolean;
}

/** Where an element is in the viewport, in CSS pixels (describe). */
export interface PageOutlineElementBox {
	x: number;
	y: number;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
}

export type PageOutlineActionResult =
	| {
			ok: true;
			action: PageOutlineAction;
			ref?: string;
			detail?: string;
			/** describe: the element's box, to cut a screenshot to. */
			box?: PageOutlineElementBox;
	  }
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
	"svg",
	"math",
]);
/** Surfaces the agent uses by position; listed with their place on screen. */
const REGION_TAGS = new Set(["canvas", "video"]);
/** Roles a page gives its own controls, like a div that acts as a checkbox. */
const CONTROL_ROLES = new Set([
	"button",
	"link",
	"tab",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"checkbox",
	"radio",
	"switch",
	"option",
	"combobox",
	"treeitem",
	"slider",
	"spinbutton",
	"textbox",
	"searchbox",
]);
const EDITABLE_SELECTOR =
	'[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
/** What a page shows while it loads: a busy region, a spinner-like progress bar. */
const BUSY_SELECTOR =
	'[aria-busy="true"],[role="progressbar"]:not([aria-valuenow]),progress:not([value])';
/** Anything that takes a click or text, natively or by the page's own markup. */
const INTERACTIVE_SELECTOR = [
	"a[href]",
	"button",
	"input",
	"textarea",
	"select",
	"summary",
	...Array.from(CONTROL_ROLES, (role) => `[role="${role}"]`),
	"[onclick]",
	'[tabindex]:not([tabindex="-1"])',
	EDITABLE_SELECTOR,
].join(",");
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
	"range",
	"color",
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

const isVisible = (element: Element, style: CSSStyleDeclaration): boolean => {
	if (element.hasAttribute("hidden")) return false;
	if (element.getAttribute("aria-hidden") === "true") return false;
	if (style.display === "none" || style.visibility === "hidden") return false;
	// A wrapper drawn as its children (Svelte's hydration wrapper, layout
	// helpers) has no box of its own; it used to hide a whole page's content.
	if (style.display === "contents") return true;
	return element.getClientRects().length > 0;
};

/**
 * The page says it is still loading. Only a document still parsing counts:
 * one that stays "interactive" (a written page whose load never fires) is
 * already drawn.
 */
const isPageBusy = (doc: Document): boolean => {
	if (doc.readyState === "loading") return true;
	const view = doc.defaultView;
	if (!view) return false;
	return Array.from(doc.querySelectorAll(BUSY_SELECTOR)).some((element) =>
		isVisible(element, view.getComputedStyle(element)),
	);
};

/** The outermost element of a rich-text editor (contenteditable). */
const isEditableRoot = (element: Element): boolean =>
	element.matches(EDITABLE_SELECTOR) &&
	!element.parentElement?.closest(EDITABLE_SELECTOR);

const isEditable = (element: Element): boolean =>
	Boolean(element.closest(EDITABLE_SELECTOR));

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
	if (isEditableRoot(element)) return true;
	const role = element.getAttribute("role");
	return Boolean(role && CONTROL_ROLES.has(role));
};

/** A web component's own markup counts too: its host is a container. */
const hasInteractiveDescendant = (element: Element): boolean =>
	Boolean(element.shadowRoot || element.querySelector(INTERACTIVE_SELECTOR));

const isTabStop = (element: Element): boolean => {
	const tabIndex = element.getAttribute("tabindex");
	return tabIndex !== null && tabIndex.trim() !== "" && Number(tabIndex) >= 0;
};

/**
 * A control the page made of plain elements: one with a click handler in its
 * markup, a tab stop, or the outermost element with a pointer cursor. Holding
 * a control of its own, it is a container and its controls are listed instead.
 */
const isPageClickable = (
	element: Element,
	style: CSSStyleDeclaration,
	view: Window,
): boolean => {
	const doc = element.ownerDocument;
	if (element === doc.body || element === doc.documentElement) return false;
	const pointer =
		style.cursor === "pointer" &&
		(!element.parentElement ||
			view.getComputedStyle(element.parentElement).cursor !== "pointer");
	if (!pointer && !element.hasAttribute("onclick") && !isTabStop(element))
		return false;
	return !hasInteractiveDescendant(element);
};

/** What a toggle-like control says about itself. */
const controlState = (element: Element): string | undefined => {
	const checked = element.getAttribute("aria-checked");
	if (checked === "true") return "checked";
	if (checked === "false") return "unchecked";
	if (checked === "mixed") return "mixed";
	if (element.getAttribute("aria-pressed") === "true") return "pressed";
	if (element.getAttribute("aria-selected") === "true") return "selected";
	const expanded = element.getAttribute("aria-expanded");
	if (expanded === "true") return "expanded";
	if (expanded === "false") return "collapsed";
	if (tagOf(element) === "summary") {
		const details = element.parentElement;
		if (details && tagOf(details) === "details")
			return details.hasAttribute("open") ? "expanded" : "collapsed";
	}
	return undefined;
};

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

/** Text as drawn: a slot shows the nodes assigned to it, not its own. */
const slottedText = (node: Node): string => {
	if (node.nodeType === 3) return node.textContent ?? "";
	if (node.nodeType !== 1) return "";
	const element = node as Element;
	const tag = tagOf(element);
	if (tag === "style" || tag === "script") return "";
	const assigned =
		tag === "slot"
			? ((element as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [])
			: [];
	const children = assigned.length ? assigned : Array.from(element.childNodes);
	return children.map(slottedText).join(" ");
};

const elementText = (element: Element): string => {
	// Inside a web component, a label usually comes in through a slot.
	const inShadow = "host" in element.getRootNode();
	const text = clean(
		inShadow ? slottedText(element) : element.textContent,
		MAX_LABEL_CHARS,
	);
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
	/**
	 * Where it is drawn, in viewport pixels: a scrolled pane moves its blocks,
	 * a pinned header keeps its own.
	 */
	top: number;
	bottom: number;
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
	if (isEditableRoot(element)) {
		return {
			kind: "input",
			ref,
			inputType: "textbox",
			label: accessibleLabel(element),
			value: clean(element.textContent, MAX_LABEL_CHARS),
			placeholder:
				clean(
					element.getAttribute("aria-placeholder") ??
						element.getAttribute("data-placeholder"),
					MAX_LABEL_CHARS,
				) || undefined,
		};
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
		if (inputType === "checkbox" || inputType === "radio") {
			return {
				kind: "input",
				ref,
				inputType,
				label: accessibleLabel(element),
				value: "",
				checked: (element as HTMLInputElement).checked,
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
	const role = element.getAttribute("role");
	const controlled = controlState(element);
	return {
		kind: "button",
		ref,
		text: elementText(element) || "button",
		submits: clickSubmitsPostForm(element),
		...(role && role !== "button" ? { role } : {}),
		...(controlled ? { state: controlled } : {}),
	};
};

const regionBlock = (
	element: Element,
	state: OutlineState,
): PageOutlineBlock | null => {
	const rect = element.getBoundingClientRect();
	if (rect.width < MIN_IMAGE_SIZE || rect.height < MIN_IMAGE_SIZE) return null;
	return {
		kind: "region",
		ref: refFor(state, element),
		tag: tagOf(element),
		label: accessibleLabel(element),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
		x: Math.round(rect.left),
		y: Math.round(rect.top),
	};
};

const collectBlocks = (doc: Document, state: OutlineState): Collected[] => {
	const view = doc.defaultView;
	const out: Collected[] = [];
	const root = doc.body ?? doc.documentElement;
	if (!root || !view) return out;
	let visited = 0;

	const push = (block: PageOutlineBlock, element: Element) => {
		const { top, bottom } = element.getBoundingClientRect();
		const previous = out[out.length - 1];
		if (previous && block.kind === "text" && previous.block.kind === "text") {
			previous.block.text = clean(
				`${previous.block.text} ${block.text}`,
				MAX_TEXT_CHARS,
			);
			previous.bottom = Math.max(previous.bottom, bottom);
			return;
		}
		if (previous && block.kind === "list" && previous.block.kind === "list") {
			previous.block.items.push(...block.items);
			previous.bottom = Math.max(previous.bottom, bottom);
			return;
		}
		out.push({ block, top, bottom });
	};

	// A paragraph's controls are looked up, not walked to; one inside another
	// would be found twice.
	const walked = new Set<Element>();
	const walk = (element: Element): void => {
		if (visited++ > MAX_VISITED_ELEMENTS) return;
		if (walked.has(element)) return;
		walked.add(element);
		const tag = tagOf(element);
		if (SKIP_TAGS.has(tag)) return;
		const style = view.getComputedStyle(element);
		if (!isVisible(element, style)) return;

		if (isInteractive(element)) {
			const block = interactiveBlock(element, state);
			if (block) push(block, element);
			return;
		}
		if (REGION_TAGS.has(tag)) {
			const block = regionBlock(element, state);
			if (block) push(block, element);
			return;
		}
		if (isPageClickable(element, style, view)) {
			const controlled = controlState(element);
			push(
				{
					kind: "button",
					ref: refFor(state, element),
					text: elementText(element) || "button",
					submits: false,
					...(controlled ? { state: controlled } : {}),
				},
				element,
			);
			// Text longer than a label is read as well, not cut down to one.
			const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
			if (text.length <= MAX_LABEL_CHARS) return;
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
				element.querySelectorAll(`${INTERACTIVE_SELECTOR},img,canvas,video`),
			)) {
				walk(child);
			}
			return;
		}
		// A web component draws its open shadow root, which shows the
		// element's own children where it slots them.
		const nodes = [
			...Array.from(element.shadowRoot?.childNodes ?? []),
			...Array.from(element.childNodes),
		];
		for (const node of nodes) {
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
			return `[${block.ref}] ${block.role ?? "button"} ${quote(block.text)}${block.state ? ` (${block.state})` : ""}${block.submits ? " (submits a form)" : ""}`;
		case "input": {
			if (block.checked !== undefined) {
				return `[${block.ref}] ${block.inputType}${block.label ? ` ${quote(block.label)}` : ""} (${block.checked ? "checked" : "unchecked"})`;
			}
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
		case "region":
			return `[${block.ref}] ${block.tag}${block.label ? ` ${quote(block.label)}` : ""} ${block.width}×${block.height} at ${block.x},${block.y}`;
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
 * The blocks that fit the budget: what is on screen, then what is below it,
 * each in page order; what was scrolled past is left out. Blocks go by where
 * they are drawn, so scrolling an app's pane reads on as the page does, and
 * a pinned header neither holds the outline at the top nor gets left out.
 */
const pickBlocks = (
	collected: Collected[],
	maxChars: number,
	viewportHeight: number,
): { keep: boolean[]; above: number } => {
	const sizes = collected.map(
		({ block }) => formatOutlineBlock(block).length + 1,
	);
	const keep = collected.map(() => true);
	if (sizes.reduce((sum, size) => sum + size, 0) <= maxChars) {
		return { keep, above: 0 };
	}
	keep.fill(false);
	// A little of what was just scrolled past stays, to read on from.
	const scrolledPast = -viewportHeight * 0.25;
	const tierOf = ({ top, bottom }: Collected): number =>
		bottom < scrolledPast ? 2 : top < viewportHeight ? 0 : 1;
	const tiers = collected.map(tierOf);
	let used = 0;
	fill: for (const tier of [0, 1]) {
		for (let index = 0; index < collected.length; index += 1) {
			if (tiers[index] !== tier) continue;
			if (used + sizes[index] > maxChars) break fill;
			keep[index] = true;
			used += sizes[index];
		}
	}
	if (!keep.includes(true)) {
		const next = tiers.findIndex((tier) => tier !== 2);
		if (next >= 0) {
			keep[next] = true;
		} else {
			// Scrolled past everything: the end of the page.
			for (let index = collected.length - 1; index >= 0; index -= 1) {
				if (keep.includes(true) && used + sizes[index] > maxChars) break;
				keep[index] = true;
				used += sizes[index];
			}
		}
	}
	const above = tiers.filter(
		(tier, index) => tier === 2 && !keep[index],
	).length;
	return { keep, above };
};

/**
 * Builds the outline. When the page does not fit the budget, it shows what
 * is on screen and below, so scrolling moves the outline with the reader.
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
	const { keep, above } = pickBlocks(collected, maxChars, viewportHeight);
	const blocks = collected
		.filter((_, index) => keep[index])
		.map(({ block }) => block);
	const pane = pageScroller(doc);

	return {
		url: doc.location?.href ?? doc.URL,
		title: clean(doc.title, 200),
		docToken: state.token,
		blocks,
		omittedAbove: above,
		omittedBelow: collected.length - blocks.length - above,
		scroll: {
			y: Math.round(pane.position().top),
			viewportHeight: Math.round(viewportHeight),
			pageHeight: Math.round(
				viewportHeight + Math.max(0, pane.extent.height - pane.box.height),
			),
			viewportWidth: Math.round(view?.innerWidth ?? 0),
		},
		...(isPageBusy(doc) ? { busy: true } : {}),
	};
};

/** The element a ref of the latest outline stands for. */
export const elementOfRef = (
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

// ── Pointer and keyboard ────────────────────────────────────────────────────
// Events are made from the target's own window, so a page in a frame gets its
// own event classes. The page sees them as untrusted, which components that
// only listen for them do not check.

interface Point {
	x: number;
	y: number;
}

type EventWindow = Window & {
	MouseEvent: typeof MouseEvent;
	PointerEvent?: typeof PointerEvent;
	KeyboardEvent: typeof KeyboardEvent;
};

const eventWindow = (element: Element): EventWindow | null =>
	element.ownerDocument.defaultView as EventWindow | null;

/** The parent, past a shadow root's boundary too. */
const parentOf = (element: Element): Element | null => {
	if (element.parentElement) return element.parentElement;
	const root = element.getRootNode();
	return "host" in root ? ((root as ShadowRoot).host ?? null) : null;
};

const isWithin = (container: Element, element: Element): boolean => {
	for (let node: Element | null = element; node; node = parentOf(node)) {
		if (node === container) return true;
	}
	return false;
};

/** Whole pixels: a mouse event's clientX and clientY drop the fraction. */
const pixel = (x: number, y: number): Point => ({
	x: Math.round(x),
	y: Math.round(y),
});

const centerOf = (element: Element): Point => {
	const rect = element.getBoundingClientRect();
	return pixel(rect.left + rect.width / 2, rect.top + rect.height / 2);
};

/** One pointer or mouse event at a viewport point; false when the page cancelled it. */
const firePointer = (
	target: Element,
	type: string,
	point: Point,
	init: MouseEventInit = {},
): boolean => {
	const view = eventWindow(target);
	const pointer = type.startsWith("pointer");
	const EventCtor =
		(pointer ? view?.PointerEvent : undefined) ??
		view?.MouseEvent ??
		MouseEvent;
	// enter and leave do not bubble, and cannot be cancelled.
	const bubbles = !/(?:enter|leave)$/.test(type);
	return target.dispatchEvent(
		new EventCtor(type, {
			bubbles,
			cancelable: bubbles,
			composed: true,
			clientX: point.x,
			clientY: point.y,
			screenX: point.x,
			screenY: point.y,
			button: 0,
			buttons: 0,
			...(pointer
				? { pointerId: 1, pointerType: "mouse", isPrimary: true }
				: {}),
			...init,
		} as PointerEventInit),
	);
};

const hoverAt = (target: Element, point: Point): void => {
	// Entering an element enters each one around it: enter events go to every
	// one, outermost first, so a wrapper's hover menu opens.
	const entered: Element[] = [];
	for (let node: Element | null = target; node; node = parentOf(node)) {
		entered.unshift(node);
	}
	firePointer(target, "pointerover", point);
	for (const element of entered) firePointer(element, "pointerenter", point);
	firePointer(target, "mouseover", point);
	for (const element of entered) firePointer(element, "mouseenter", point);
	firePointer(target, "pointermove", point);
	firePointer(target, "mousemove", point);
};

const FOCUSABLE_SELECTOR = `a[href],button,input,textarea,select,summary,[tabindex],${EDITABLE_SELECTOR}`;

/**
 * A click as the browser makes one: over, down, focus, up, click. Menus and
 * custom selects that open on pointerdown or mousedown ignore a bare click().
 */
const clickAt = (target: Element, point: Point): void => {
	hoverAt(target, point);
	// A cancelled pointerdown has no mouse events after it, only the click.
	const pointerDown = firePointer(target, "pointerdown", point, { buttons: 1 });
	const mouseDown =
		pointerDown &&
		firePointer(target, "mousedown", point, { buttons: 1, detail: 1 });
	// A cancelled mousedown leaves focus where it was, as custom selects need.
	if (mouseDown) {
		(target.closest(FOCUSABLE_SELECTOR) as HTMLElement | null)?.focus?.({
			preventScroll: true,
		});
	}
	firePointer(target, "pointerup", point);
	if (pointerDown) firePointer(target, "mouseup", point, { detail: 1 });
	firePointer(target, "click", point, { detail: 1 });
};

/** The slot showing a host's text node at a point. */
const slotOfTextAt = (host: Element, point: Point): Element | null => {
	const doc = host.ownerDocument;
	if (typeof doc.createRange !== "function") return null;
	for (const node of Array.from(host.childNodes)) {
		const slot = (node as Text).assignedSlot;
		if (node.nodeType !== 3 || !slot) continue;
		const range = doc.createRange();
		range.selectNodeContents(node);
		const rect = range.getBoundingClientRect();
		if (
			point.x >= rect.left &&
			point.x <= rect.right &&
			point.y >= rect.top &&
			point.y <= rect.bottom
		) {
			return slot;
		}
	}
	return null;
};

/**
 * The element drawn at a viewport point, looking into open shadow roots and
 * same-origin frames, with the point in that element's own viewport.
 */
const elementAt = (
	doc: Document,
	point: Point,
): { element: Element; point: Point } | null => {
	if (typeof doc.elementFromPoint !== "function") return null;
	let element = doc.elementFromPoint(point.x, point.y);
	let at = point;
	for (let depth = 0; element && depth < 8; depth += 1) {
		const inShadow = element.shadowRoot?.elementFromPoint?.(at.x, at.y);
		if (inShadow && inShadow !== element) {
			element = inShadow;
			continue;
		}
		if (element.shadowRoot) {
			// The host's own text, drawn through a slot: a press there passes
			// the slot and the control around it, as a real one does.
			const slot = slotOfTextAt(element, at);
			if (slot) element = slot;
			break;
		}
		const tag = tagOf(element);
		if (tag !== "iframe" && tag !== "frame") break;
		let inner: Document | null = null;
		try {
			inner = (element as HTMLIFrameElement).contentDocument;
		} catch {
			inner = null;
		}
		if (!inner || typeof inner.elementFromPoint !== "function") break;
		const rect = element.getBoundingClientRect();
		const framed = {
			x: at.x - rect.left - (element as HTMLElement).clientLeft,
			y: at.y - rect.top - (element as HTMLElement).clientTop,
		};
		const hit = inner.elementFromPoint(framed.x, framed.y);
		if (!hit) break;
		element = hit;
		at = framed;
	}
	return element ? { element, point: at } : null;
};

/** How an element reads on the screen: its ref and label, else its tag and text. */
const describeElement = (doc: Document, element: Element): string => {
	const { refs } = getState(doc);
	for (let node: Element | null = element; node; node = parentOf(node)) {
		const ref = refs.get(node);
		if (ref) {
			const label = elementText(node);
			return `${ref}${label ? ` ${quote(label)}` : ""}`;
		}
	}
	const text = clean(element.textContent, 60);
	return `<${tagOf(element)}>${text ? ` ${quote(text)}` : ""}`;
};

const assertSameDocument = (doc: Document, docToken?: string): void => {
	if (docToken && docToken !== getState(doc).token)
		throw new StaleOutlineError();
};

/**
 * Where a click or hover lands: a ref, at its center or at x, y from its
 * top-left corner, or a point in the viewport. On a ref, the innermost
 * element drawn there takes the events when it is part of the ref; an
 * overlay on top of it is passed over.
 */
const resolvePoint = (
	doc: Document,
	request: PageOutlineActionRequest,
): { target: Element; point: Point } => {
	const hasPoint = request.x !== undefined || request.y !== undefined;
	if (hasPoint && !(Number.isFinite(request.x) && Number.isFinite(request.y))) {
		throw new Error("Give both x and y, in CSS pixels.");
	}
	const x = request.x ?? 0;
	const y = request.y ?? 0;
	if (request.ref) {
		const element = elementOfRef(doc, request.ref, request.docToken);
		(element as HTMLElement).scrollIntoView?.(
			hasPoint ? { block: "nearest", inline: "nearest" } : { block: "center" },
		);
		const rect = element.getBoundingClientRect();
		if (hasPoint && (x < 0 || y < 0 || x > rect.width || y > rect.height)) {
			throw new Error(
				`${request.ref} is ${Math.round(rect.width)}×${Math.round(rect.height)}: x and y go from its top-left corner, inside it.`,
			);
		}
		const point = hasPoint
			? pixel(rect.left + x, rect.top + y)
			: centerOf(element);
		const hit = elementAt(doc, point);
		return hit && isWithin(element, hit.element)
			? { target: hit.element, point: hit.point }
			: { target: element, point };
	}
	if (!hasPoint) {
		throw new Error(
			"This action needs a ref from the screen, like b4, or x and y.",
		);
	}
	assertSameDocument(doc, request.docToken);
	const view = doc.defaultView;
	const width = Math.round(view?.innerWidth ?? 0);
	const height = Math.round(view?.innerHeight ?? 0);
	if (x < 0 || y < 0 || (width && x > width) || (height && y > height)) {
		throw new Error(
			`(${x}, ${y}) is outside the viewport, which is ${width}×${height}. Scroll first, or use a ref.`,
		);
	}
	const hit = elementAt(doc, { x, y });
	if (!hit) throw new Error(`Nothing is drawn at (${x}, ${y}).`);
	return { target: hit.element, point: hit.point };
};

interface KeyPress {
	key: string;
	code: string;
	keyCode: number;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}

const KEY_CODES: Record<string, number> = {
	Enter: 13,
	Escape: 27,
	Tab: 9,
	" ": 32,
	Backspace: 8,
	Delete: 46,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Home: 36,
	End: 35,
	PageUp: 33,
	PageDown: 34,
};

const KEY_NAMES: Record<string, string> = {
	...Object.fromEntries(
		Object.keys(KEY_CODES).map((key) => [key.toLowerCase(), key]),
	),
	esc: "Escape",
	return: "Enter",
	space: " ",
	spacebar: " ",
	del: "Delete",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
};

/** "Enter", "Shift+Tab", "Control+a": the key and its modifiers. */
const parseKey = (input: string | undefined): KeyPress => {
	const raw = (input ?? "").trim();
	if (!raw) {
		throw new Error('Give the key in text, like "Enter", "Escape" or "Tab".');
	}
	const parts =
		raw.length > 1 && raw.endsWith("+")
			? [...raw.slice(0, -1).split("+"), "+"]
			: raw.split("+");
	const name = parts.pop()?.trim() ?? "";
	const modifiers = new Set(parts.map((part) => part.trim().toLowerCase()));
	const key = name.length === 1 ? name : KEY_NAMES[name.toLowerCase()];
	if (!key) {
		throw new Error(
			`Unknown key "${name}". Use Enter, Escape, Tab, Space, Backspace, Delete, an arrow (ArrowDown), Home, End, PageUp, PageDown or one character.`,
		);
	}
	const code =
		key === " "
			? "Space"
			: /^[a-z]$/i.test(key)
				? `Key${key.toUpperCase()}`
				: /^\d$/.test(key)
					? `Digit${key}`
					: key.length === 1
						? ""
						: key;
	return {
		key,
		code,
		keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
		ctrlKey: modifiers.has("control") || modifiers.has("ctrl"),
		shiftKey: modifiers.has("shift"),
		altKey: modifiers.has("alt") || modifiers.has("option"),
		metaKey:
			modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
	};
};

const fireKey = (target: Element, type: string, press: KeyPress): boolean => {
	const view = eventWindow(target);
	const KeyCtor = view?.KeyboardEvent ?? KeyboardEvent;
	return target.dispatchEvent(
		new KeyCtor(type, {
			key: press.key,
			code: press.code,
			keyCode: press.keyCode,
			which: press.keyCode,
			ctrlKey: press.ctrlKey,
			shiftKey: press.shiftKey,
			altKey: press.altKey,
			metaKey: press.metaKey,
			bubbles: true,
			cancelable: true,
			composed: true,
		}),
	);
};

/** keydown, keypress (a character or Enter), keyup; false when keydown was cancelled. */
const dispatchKey = (target: Element, press: KeyPress): boolean => {
	const proceed = fireKey(target, "keydown", press);
	if (proceed && (press.key.length === 1 || press.key === "Enter"))
		fireKey(target, "keypress", press);
	fireKey(target, "keyup", press);
	return proceed;
};

const ENTER = parseKey("Enter");

/** The focused element, inside open shadow roots and same-origin frames. */
const focusedElement = (doc: Document): Element | null => {
	let element: Element | null = doc.activeElement;
	for (let depth = 0; element && depth < 8; depth += 1) {
		const inShadow = element.shadowRoot?.activeElement;
		if (inShadow) {
			element = inShadow;
			continue;
		}
		let inner: Document | null = null;
		try {
			inner = (element as HTMLIFrameElement).contentDocument ?? null;
		} catch {
			inner = null;
		}
		if (!inner?.activeElement) break;
		element = inner.activeElement;
	}
	return element;
};

/** Whether Enter or Space presses this control, as it would for a user. */
const pressedByKey = (element: Element, key: string): boolean => {
	const tag = tagOf(element);
	const type = (element.getAttribute("type") ?? "").toLowerCase();
	const role = element.getAttribute("role") ?? "";
	if (tag === "input") {
		if (type === "checkbox" || type === "radio") return key === " ";
		return ["submit", "button", "reset", "image"].includes(type);
	}
	if (tag === "a" || role === "link") return key === "Enter";
	if (tag === "button" || tag === "summary") return true;
	return (
		CONTROL_ROLES.has(role) &&
		!["textbox", "searchbox", "combobox", "slider", "spinbutton"].includes(role)
	);
};

const isTextField = (element: Element): boolean =>
	tagOf(element) === "input" &&
	TEXT_INPUT_TYPES.has((element.getAttribute("type") ?? "text").toLowerCase());

/** The next (or previous) control a user reaches with Tab. */
const tabTarget = (
	doc: Document,
	from: Element | null,
	backwards: boolean,
): HTMLElement | null => {
	const view = doc.defaultView;
	const candidates = Array.from(
		doc.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	).filter(
		(element) =>
			Number(element.getAttribute("tabindex") ?? 0) >= 0 &&
			!(element as HTMLButtonElement).disabled &&
			element.getAttribute("type") !== "hidden" &&
			(!view || isVisible(element, view.getComputedStyle(element))),
	);
	if (!candidates.length) return null;
	const index = from ? candidates.indexOf(from as HTMLElement) : -1;
	const next = backwards
		? index <= 0
			? candidates.length - 1
			: index - 1
		: (index + 1) % candidates.length;
	return candidates[next] ?? null;
};

/**
 * Text into a rich-text editor, in the order typing makes it: the selection,
 * then beforeinput, which an editor that keeps its own model takes over by
 * cancelling (Lexical, Slate), then the change itself and its input event,
 * which the others read from the page (ProseMirror, Quill, Draft).
 * execCommand sends no beforeinput of its own; setting the text is the
 * last resort.
 */
const setEditableText = (element: HTMLElement, value: string): void => {
	element.focus?.();
	const doc = element.ownerDocument;
	const view = doc.defaultView as
		| (Window & { Event: typeof Event; InputEvent?: typeof InputEvent })
		| null;
	const selection = view?.getSelection?.();
	if (selection && typeof doc.createRange === "function") {
		const range = doc.createRange();
		range.selectNodeContents(element);
		selection.removeAllRanges();
		selection.addRange(range);
		// The browser says so only later; editors sync their selection from it.
		doc.dispatchEvent(new (view?.Event ?? Event)("selectionchange"));
	}
	const InputEventCtor =
		view?.InputEvent ??
		(typeof InputEvent === "undefined" ? undefined : InputEvent);
	if (
		InputEventCtor &&
		!element.dispatchEvent(
			new InputEventCtor("beforeinput", {
				inputType: "insertText",
				data: value,
				bubbles: true,
				cancelable: true,
				composed: true,
			}),
		)
	) {
		return;
	}
	let inserted = false;
	try {
		inserted =
			typeof doc.execCommand === "function" &&
			doc.execCommand("insertText", false, value);
	} catch {
		inserted = false;
	}
	if (!inserted) {
		element.textContent = value;
		dispatch(element, "input");
	}
};

/** Whether a checkbox, radio, switch or toggle button is on; undefined for other controls. */
const isOn = (element: Element): boolean | undefined => {
	const tag = tagOf(element);
	const type = (element.getAttribute("type") ?? "").toLowerCase();
	if (tag === "input" && (type === "checkbox" || type === "radio"))
		return (element as HTMLInputElement).checked;
	const checked = element.getAttribute("aria-checked");
	if (checked !== null) return checked === "true";
	const pressed = element.getAttribute("aria-pressed");
	if (pressed !== null) return pressed === "true";
	return undefined;
};

type ScrollDirection = "up" | "down" | "left" | "right" | "top" | "bottom";

const SCROLL_DIRECTIONS = new Set<string>([
	"up",
	"down",
	"left",
	"right",
	"top",
	"bottom",
]);

const isHorizontal = (direction: ScrollDirection): boolean =>
	direction === "left" || direction === "right";

const scrollsOn = (element: Element, horizontal: boolean): boolean => {
	const doc = element.ownerDocument;
	const view = doc.defaultView;
	if (!view || element === doc.documentElement) return false;
	const overflow = (target: Element) => {
		const style = view.getComputedStyle(target);
		return horizontal ? style.overflowX : style.overflowY;
	};
	if (!/(?:auto|scroll|overlay)/.test(overflow(element))) return false;
	// The body's overflow is the page's own while the root's is visible.
	if (
		element === doc.body &&
		doc.documentElement &&
		overflow(doc.documentElement) === "visible"
	)
		return false;
	return horizontal
		? element.scrollWidth > element.clientWidth + 1
		: element.scrollHeight > element.clientHeight + 1;
};

/** The areas an element scrolls in, innermost first. */
const scrollAreasAround = (
	element: Element,
	horizontal: boolean,
): Element[] => {
	const areas: Element[] = [];
	for (let node: Element | null = element; node; node = parentOf(node)) {
		if (scrollsOn(node, horizontal)) areas.push(node);
	}
	return areas;
};

/** Something that scrolls: an area of the page, or the page itself. */
interface Scroller {
	/** Null for the page. */
	area: Element | null;
	box: { width: number; height: number };
	extent: { width: number; height: number };
	position: () => { left: number; top: number };
}

const scrollerOf = (doc: Document, area: Element | null): Scroller => {
	if (area) {
		return {
			area,
			box: { width: area.clientWidth, height: area.clientHeight },
			extent: { width: area.scrollWidth, height: area.scrollHeight },
			position: () => ({ left: area.scrollLeft, top: area.scrollTop }),
		};
	}
	const view = doc.defaultView;
	const root = doc.scrollingElement ?? doc.documentElement;
	return {
		area: null,
		box: { width: view?.innerWidth || 800, height: view?.innerHeight || 600 },
		extent: { width: root?.scrollWidth ?? 0, height: root?.scrollHeight ?? 0 },
		position: () => ({ left: view?.scrollX ?? 0, top: view?.scrollY ?? 0 }),
	};
};

/** Whether a scroller has room left that way. */
const canMove = (scroller: Scroller, direction: ScrollDirection): boolean => {
	const { left, top } = scroller.position();
	switch (direction) {
		case "up":
		case "top":
			return top > 0;
		case "down":
		case "bottom":
			return top < scroller.extent.height - scroller.box.height - 1;
		case "left":
			return left > 0;
		case "right":
			return left < scroller.extent.width - scroller.box.width - 1;
	}
};

/** Points of the viewport, as fractions, where the page's main area is looked for. */
const MAIN_AREA_PROBES = [
	[0.5, 0.5],
	[0.5, 0.25],
	[0.5, 0.75],
	[0.3, 0.5],
	[0.7, 0.5],
] as const;

/**
 * The area that scrolls an app whose document stays put (its main pane),
 * found under a few points of the viewport as a wheel would: the biggest
 * one with room left that way, else the biggest.
 */
const mainScrollArea = (
	doc: Document,
	direction: ScrollDirection,
): Element | null => {
	const view = doc.defaultView;
	const width = view?.innerWidth ?? 0;
	const height = view?.innerHeight ?? 0;
	if (!width || !height) return null;
	const areas = new Set<Element>();
	for (const [x, y] of MAIN_AREA_PROBES) {
		const hit = elementAt(doc, { x: width * x, y: height * y });
		if (!hit || hit.element.ownerDocument !== doc) continue;
		for (const area of scrollAreasAround(hit.element, isHorizontal(direction)))
			areas.add(area);
	}
	const size = (area: Element) => area.clientWidth * area.clientHeight;
	const ranked = [...areas].sort((a, b) => size(b) - size(a));
	return (
		ranked.find((area) => canMove(scrollerOf(doc, area), direction)) ??
		ranked[0] ??
		null
	);
};

/** What scrolls the page down: the document, or its main area when only that scrolls. */
const pageScroller = (doc: Document): Scroller => {
	const page = scrollerOf(doc, null);
	if (page.extent.height > page.box.height + 1) return page;
	const main = mainScrollArea(doc, "down");
	return main ? scrollerOf(doc, main) : page;
};

/**
 * Where a scroll goes, as a wheel would: with a ref, the innermost area
 * around it with room left that way, else the page; without one, the page,
 * or its main area when the document itself cannot move.
 */
const scrollTarget = (
	doc: Document,
	request: PageOutlineActionRequest,
	direction: ScrollDirection,
): { scroller: Scroller; where: string } => {
	const page = scrollerOf(doc, null);
	const { ref } = request;
	if (ref) {
		const areas = scrollAreasAround(
			elementOfRef(doc, ref, request.docToken),
			isHorizontal(direction),
		).map((area) => scrollerOf(doc, area));
		const index = areas.findIndex((area) => canMove(area, direction));
		if (index >= 0) {
			return {
				scroller: areas[index],
				where: index === 0 ? `${ref}'s scroll area` : `The area around ${ref}`,
			};
		}
		if (areas.length && !canMove(page, direction)) {
			return { scroller: areas[0], where: `${ref}'s scroll area` };
		}
	}
	if (canMove(page, direction)) return { scroller: page, where: "The page" };
	const main = mainScrollArea(doc, direction);
	return main
		? { scroller: scrollerOf(doc, main), where: "The page's main area" }
		: { scroller: page, where: "The page" };
};

/** Scrolls the page, or the area a ref is in, and says where it ended up. */
const scrollPage = (
	doc: Document,
	request: PageOutlineActionRequest,
): PageOutlineActionResult => {
	const value = (request.value ?? "down").trim().toLowerCase();
	if (!SCROLL_DIRECTIONS.has(value)) {
		throw new Error(
			`Scroll up, down, left, right, top or bottom, not "${request.value}".`,
		);
	}
	const direction = value as ScrollDirection;
	const horizontal = isHorizontal(direction);
	const { scroller, where } = scrollTarget(doc, request, direction);
	const { area, box, extent } = scroller;
	const before = scroller.position();
	const step = (size: number) => Math.round(size * 0.85);
	const next = { ...before };
	if (direction === "up") next.top -= step(box.height);
	if (direction === "down") next.top += step(box.height);
	if (direction === "left") next.left -= step(box.width);
	if (direction === "right") next.left += step(box.width);
	if (direction === "top") next.top = 0;
	if (direction === "bottom") next.top = extent.height;
	const target = area ?? doc.defaultView;
	if (typeof target?.scrollTo === "function") {
		target.scrollTo({ ...next, behavior: "instant" as ScrollBehavior });
	} else if (area) {
		area.scrollTop = next.top;
		area.scrollLeft = next.left;
	}
	const after = scroller.position();
	const moved = after.top !== before.top || after.left !== before.left;
	// A tab out of sight paints no frames, and the browser sends scroll
	// events with them: lists that draw their rows on one would stay put.
	const view = doc.defaultView as (Window & { Event: typeof Event }) | null;
	if (moved && view) {
		(area ?? doc).dispatchEvent(new view.Event("scroll", { bubbles: !area }));
	}
	const at = horizontal
		? `${Math.round(after.left)} of ${Math.max(0, extent.width - box.width)} px across`
		: `${Math.round(after.top)} of ${Math.max(0, extent.height - box.height)} px down`;
	return {
		ok: true,
		action: "scrollScreen",
		...(request.ref ? { ref: request.ref } : {}),
		detail: moved
			? `${where} is at ${at}.`
			: `${where} cannot scroll ${direction} any further (${at}).`,
	};
};

export const actOnRef = (
	doc: Document,
	request: PageOutlineActionRequest,
): PageOutlineActionResult => {
	const { action } = request;
	if (action === "scrollScreen") return scrollPage(doc, request);
	if (action === "click" || action === "hover") {
		const { target, point } = resolvePoint(doc, request);
		const ref = request.ref;
		const control =
			target.closest("a[href],button,input,select,textarea,summary") ?? target;
		assertActionable(target);
		if (control !== target) assertActionable(control);
		// A click by position says what it landed on.
		const landed = ref
			? {}
			: {
					detail: `at (${request.x}, ${request.y}) on ${describeElement(doc, target)}`,
				};
		if (action === "hover") {
			hoverAt(target, point);
			return { ok: true, action, ref, ...landed };
		}
		const type = (control.getAttribute("type") ?? "").toLowerCase();
		if (tagOf(control) === "input" && BLOCKED_INPUT_TYPES.has(type)) {
			throw new Error("That field needs the user.");
		}
		if (clickSubmitsPostForm(control) && !request.allowFormSubmit) {
			return {
				ok: false,
				action,
				ref,
				needsApproval: "form-submit",
				detail: "This click submits a form.",
			};
		}
		clickAt(target, point);
		return { ok: true, action, ref, ...landed };
	}
	if (action === "press") {
		const press = parseKey(request.value);
		let target: Element;
		if (request.ref) {
			target = elementOfRef(doc, request.ref, request.docToken);
			assertActionable(target);
			(target as HTMLElement).focus?.({ preventScroll: true });
		} else {
			assertSameDocument(doc, request.docToken);
			const focused = focusedElement(doc);
			target = focused ?? doc.body ?? doc.documentElement;
		}
		// The browser does not act on a page's own key events: what Enter,
		// Space and Tab would do is done here, unless the page cancels it.
		const plain = !press.ctrlKey && !press.altKey && !press.metaKey;
		const control = target.closest("a[href],button,summary,input,[role]");
		const pressed =
			plain && control && pressedByKey(control, press.key) ? control : null;
		const form =
			plain && press.key === "Enter" && !pressed && isTextField(target)
				? formOf(target)
				: null;
		if (
			((pressed && clickSubmitsPostForm(pressed)) || isPostForm(form)) &&
			!request.allowFormSubmit
		) {
			return {
				ok: false,
				action,
				ref: request.ref,
				needsApproval: "form-submit",
				detail: "Pressing Enter here submits a form.",
			};
		}
		const proceed = dispatchKey(target, press);
		let detail = `on ${describeElement(doc, target)}`;
		if (proceed && plain && press.key === "Tab") {
			const next = tabTarget(target.ownerDocument, target, press.shiftKey);
			if (next) {
				next.focus();
				detail = `focus moved to ${describeElement(doc, next)}`;
			}
		} else if (proceed && pressed) {
			clickAt(pressed, centerOf(pressed));
		} else if (proceed && form) {
			if (typeof form.requestSubmit === "function") form.requestSubmit();
		}
		return { ok: true, action, ref: request.ref, detail };
	}

	const element = elementOfRef(doc, request.ref, request.docToken);
	const ref = request.ref;
	assertActionable(element);
	const tag = tagOf(element);

	// Any element: an image's address, and where it is to take its picture.
	if (action === "describe") {
		(element as HTMLElement).scrollIntoView?.({
			block: "nearest",
			inline: "nearest",
		});
		const rect = element.getBoundingClientRect();
		const view = element.ownerDocument.defaultView;
		return {
			ok: true,
			action,
			ref,
			detail: tag === "img" ? (imageSource(element) ?? "") : "",
			box: {
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
				viewportWidth: view?.innerWidth ?? 0,
				viewportHeight: view?.innerHeight ?? 0,
			},
		};
	}
	if (action === "focus") {
		(element as HTMLElement).focus?.();
		return { ok: true, action, ref };
	}
	if (action === "toggle") {
		const before = isOn(element);
		if (before === undefined) {
			throw new Error(`${ref} is not a checkbox or switch; click it instead.`);
		}
		const wanted = (request.value ?? "").trim().toLowerCase();
		const on =
			wanted === "on" || wanted === "true"
				? true
				: wanted === "off" || wanted === "false"
					? false
					: !before;
		if (before === on) {
			return { ok: true, action, ref, detail: `already ${on ? "on" : "off"}` };
		}
		(element as HTMLElement).scrollIntoView?.({ block: "center" });
		clickAt(element, centerOf(element));
		return { ok: true, action, ref, detail: `turned ${on ? "on" : "off"}` };
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
		if (isEditable(element)) {
			if (request.value !== undefined)
				setEditableText(element as HTMLElement, request.value);
			if (action === "submit") dispatchKey(element, ENTER);
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
			else dispatchKey(field, ENTER);
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
