/**
 * What the person using a web session's tab does there: clicks on links,
 * buttons and controls, and form submissions. Typing, scrolling and hovering
 * are left out; the page is read again after each action anyway.
 *
 * Only real input counts. The agent's own actions dispatch synthetic events
 * (`isTrusted` false), but some of what they cause is trusted (a
 * `requestSubmit()`'s submit, a `focus()`), so the agent also marks the time
 * it acts and nothing is reported then.
 *
 * Kept import-light: it is part of the content script's static graph.
 */

import {
	WEB_PAGE_ACTION_SOURCE,
	type WebPageAction,
	type WebPageActionMessage,
} from "@/services/web-browser/web-browser-protocol";

/** Shared by a re-injected copy of the content script: one isolated world. */
interface UserActionsState {
	watching: boolean;
	agentActingUntil: number;
}

declare global {
	interface Window {
		__memorallUserActions?: UserActionsState;
	}
}

const MAX_LABEL_CHARS = 60;
/** Trusted events an agent action causes can land just after it returns. */
const AGENT_GRACE_MS = 300;

/** What a click on counts as an action; a click on plain text does not. */
const ACTIONABLE_SELECTOR = [
	"a[href]",
	"button",
	"select",
	"summary",
	'input:not([type="hidden"])',
	...[
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
		"treeitem",
	].map((role) => `[role="${role}"]`),
].join(",");

/** Fields clicked into to type: the typing is not reported, nor the click. */
const TEXT_INPUT_TYPES = new Set([
	"text",
	"email",
	"password",
	"search",
	"tel",
	"url",
	"number",
	"date",
	"datetime-local",
	"month",
	"time",
	"week",
]);

const state = (): UserActionsState => {
	window.__memorallUserActions ??= { watching: false, agentActingUntil: 0 };
	return window.__memorallUserActions;
};

const agentActing = (): boolean => Date.now() < state().agentActingUntil;

/** Runs an action of the agent's: what it causes in the page is not reported. */
export const runAsAgent = async <T>(
	action: () => Promise<T> | T,
): Promise<T> => {
	const current = state();
	current.agentActingUntil = Number.POSITIVE_INFINITY;
	try {
		return await action();
	} finally {
		current.agentActingUntil = Date.now() + AGENT_GRACE_MS;
	}
};

const clean = (value: string | null | undefined): string => {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	return text.length > MAX_LABEL_CHARS
		? `${text.slice(0, MAX_LABEL_CHARS - 1)}…`
		: text;
};

const kindOf = (element: Element): string => {
	const role = element.getAttribute("role");
	if (role) return role === "menuitem" ? "menu item" : role;
	const tag = element.localName;
	if (tag === "a") return "link";
	if (tag === "input") {
		const type = (element as HTMLInputElement).type;
		return type === "checkbox" || type === "radio" ? type : "button";
	}
	if (tag === "select") return "dropdown";
	return "button";
};

/** The element's name as the page shows it; never a field's typed value. */
const labelOf = (element: Element): string => {
	const aria = clean(element.getAttribute("aria-label"));
	if (aria) return aria;
	if (element.localName === "input") {
		const input = element as HTMLInputElement;
		const label = clean(input.labels?.[0]?.textContent);
		if (label) return label;
		// A button's value is its caption.
		if (["submit", "button", "reset"].includes(input.type)) {
			return clean(input.value);
		}
		return clean(input.name);
	}
	return (
		clean(element.textContent) ||
		clean(element.getAttribute("title")) ||
		clean(element.querySelector("img[alt]")?.getAttribute("alt"))
	);
};

const describe = (element: Element): string => {
	const label = labelOf(element);
	const kind = kindOf(element);
	const checked =
		element.localName === "input" &&
		["checkbox", "radio"].includes((element as HTMLInputElement).type)
			? (element as HTMLInputElement).checked
				? " (checked)"
				: " (unchecked)"
			: "";
	return `${kind}${label ? ` "${label}"` : ""}${checked}`;
};

/** The control a click landed on, through open shadow roots. */
const actionableTarget = (event: Event): Element | null => {
	for (const node of event.composedPath()) {
		if (!(node instanceof Element)) continue;
		if (!node.matches(ACTIONABLE_SELECTOR)) continue;
		if (
			node.localName === "input" &&
			TEXT_INPUT_TYPES.has((node as HTMLInputElement).type)
		) {
			return null;
		}
		return node;
	}
	return null;
};

/**
 * Hands one action to the background. The content entry supplies it, because
 * only that file may reach for a Chrome API.
 */
export type SendUserAction = (message: WebPageActionMessage) => void;

/** This copy's channel to the background, set when watching starts. */
let send: SendUserAction | null = null;

const report = (action: WebPageAction): void => {
	try {
		send?.({ source: WEB_PAGE_ACTION_SOURCE, action });
	} catch {
		// A copy left behind by an extension reload can no longer send.
	}
};

const onClick = (event: MouseEvent): void => {
	if (!state().watching || !event.isTrusted || agentActing()) return;
	const target = actionableTarget(event);
	if (!target) return;
	const href =
		target.localName === "a" ? (target as HTMLAnchorElement).href : undefined;
	report({
		kind: "clicked",
		target: describe(target),
		...(href ? { href } : {}),
	});
};

const onSubmit = (event: SubmitEvent): void => {
	if (!state().watching || !event.isTrusted || agentActing()) return;
	const form = event.target instanceof HTMLFormElement ? event.target : null;
	if (!form) return;
	const name =
		clean(form.getAttribute("aria-label")) ||
		(event.submitter ? labelOf(event.submitter) : "") ||
		clean(form.getAttribute("name") ?? form.id);
	report({ kind: "submitted", target: `form${name ? ` "${name}"` : ""}` });
};

/** This copy's listeners; a re-injected copy adds its own. */
let listening = false;

/**
 * Starts reporting for this document. Called by the background for every
 * page a session's tab loads; a second call is a no-op.
 */
export const watchUserActions = (sendUserAction: SendUserAction): void => {
	send = sendUserAction;
	state().watching = true;
	if (listening) return;
	listening = true;
	document.addEventListener("click", onClick, true);
	document.addEventListener("submit", onSubmit, true);
};
