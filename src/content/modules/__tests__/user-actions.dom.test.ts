import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAsAgent, watchUserActions } from "../user-actions";

const sendMessage = vi.fn(async (_message: unknown) => undefined);

/**
 * Input from a person. `dispatchEvent` marks every event untrusted, as the
 * spec says, and `isTrusted` cannot be redefined. Its getter reads jsdom's own
 * record of the event, so a window capture listener (which runs before the
 * page's) sets it there, during the dispatch.
 */
let dispatchingAsUser = false;
const trustDuringDispatch = (event: Event) => {
	if (!dispatchingAsUser) return;
	for (const symbol of Object.getOwnPropertySymbols(event)) {
		const impl = (event as unknown as Record<symbol, unknown>)[symbol];
		if (impl && typeof impl === "object" && "isTrusted" in impl) {
			(impl as { isTrusted: boolean }).isTrusted = true;
		}
	}
};
window.addEventListener("click", trustDuringDispatch, true);
window.addEventListener("submit", trustDuringDispatch, true);

const dispatchAsUser = (target: EventTarget, event: Event) => {
	dispatchingAsUser = true;
	try {
		target.dispatchEvent(event);
	} finally {
		dispatchingAsUser = false;
	}
};

const click = (element: Element, trusted = true) => {
	const event = new MouseEvent("click", { bubbles: true, composed: true });
	if (trusted) dispatchAsUser(element, event);
	else element.dispatchEvent(event);
};

const reported = () =>
	sendMessage.mock.calls.map(
		([message]) => (message as { action: unknown }).action,
	);

describe("what the user does in a session's page", () => {
	beforeEach(() => {
		sendMessage.mockClear();
		// A new document: not watched until the background asks.
		delete window.__memorallUserActions;
		vi.stubGlobal("chrome", { runtime: { sendMessage } });
		document.body.innerHTML = `
			<a href="https://shop.test/pricing">Pricing</a>
			<button aria-label="Open menu"><svg></svg></button>
			<label><input type="checkbox" name="remember"> Remember me</label>
			<input type="email" name="email" value="me@example.com">
			<p id="plain">Just text</p>
			<form aria-label="Sign in"><input name="q"><button type="submit">Go</button></form>
		`;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	it("reports clicks on links, buttons and controls, as the page labels them", () => {
		watchUserActions();
		click(document.querySelector("a") as Element);
		click(document.querySelector("button svg") as Element);
		// The click checks it, then reports the state it left.
		click(document.querySelector('input[type="checkbox"]') as Element);

		expect(reported()).toEqual([
			{
				kind: "clicked",
				target: 'link "Pricing"',
				href: "https://shop.test/pricing",
			},
			{ kind: "clicked", target: 'button "Open menu"' },
			{ kind: "clicked", target: 'checkbox "Remember me" (checked)' },
		]);
	});

	it("leaves out plain text, fields being typed into, and their values", () => {
		watchUserActions();
		click(document.getElementById("plain") as Element);
		click(document.querySelector('input[type="email"]') as Element);

		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("reports a form submission with the form's name", () => {
		watchUserActions();
		const form = document.querySelector("form") as HTMLFormElement;
		form.addEventListener("submit", (event) => event.preventDefault());
		dispatchAsUser(
			form,
			new SubmitEvent("submit", { bubbles: true, cancelable: true }),
		);

		expect(reported()).toEqual([
			{ kind: "submitted", target: 'form "Sign in"' },
		]);
	});

	it("ignores the agent's synthetic events and what its actions cause", async () => {
		watchUserActions();
		const link = document.querySelector("a") as Element;
		click(link, false);
		await runAsAgent(() => click(link));

		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("says nothing in a page it was not asked to watch", () => {
		click(document.querySelector("a") as Element);
		expect(sendMessage).not.toHaveBeenCalled();

		watchUserActions();
		click(document.querySelector("a") as Element);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});
});
