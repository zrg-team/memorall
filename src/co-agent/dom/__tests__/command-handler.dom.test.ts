import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleCoAgentContentCommand,
	type CoAgentCommandContext,
} from "@/co-agent/dom/command-handler";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/co-agent/protocol";
import type { CoAgentContentCommandRequest } from "@/co-agent/protocol";
import { CO_AGENT_STATUS_EVENT } from "@/co-agent/constants";

/**
 * This is the code that actually reads, clicks and types on the user's behalf,
 * and it had no tests. It is now shared by three hosts, so its behaviour is
 * pinned here rather than rediscovered per host.
 */

const texts: CoAgentCommandContext["texts"] = {
	observingPage: "observing",
	movingRelevantArea: "moving",
	scrollingPage: "scrolling",
	checkingClick: "checking click",
	clickTarget: "click target",
	checkingType: "checking type",
	inputTarget: "input target",
	userActionRequired: "needs you",
	done: "done",
};

const request = (
	over: Partial<CoAgentContentCommandRequest> & {
		type: CoAgentContentCommandRequest["type"];
	},
): CoAgentContentCommandRequest =>
	({
		source: CO_AGENT_CONTENT_COMMAND_SOURCE,
		...over,
	}) as CoAgentContentCommandRequest;

let ensureOverlay: ReturnType<typeof vi.fn<() => void>>;
const context = (
	over: Partial<CoAgentCommandContext> = {},
): CoAgentCommandContext => ({ texts, ensureOverlay, ...over });

beforeEach(() => {
	document.body.innerHTML = "";
	ensureOverlay = vi.fn<() => void>();
});

describe("handleCoAgentContentCommand", () => {
	it("answers get-trace without mounting the overlay", async () => {
		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:get-trace" }),
			context(),
		);
		expect(response.success).toBe(true);
		// get-trace is a pure read: making it mount UI would flash a dock onto a
		// page the agent is only inspecting.
		expect(ensureOverlay).not.toHaveBeenCalled();
	});

	it("mounts the overlay for any command that acts on the page", async () => {
		await handleCoAgentContentCommand(
			request({ type: "co-agent:observe" }),
			context(),
		);
		expect(ensureOverlay).toHaveBeenCalledTimes(1);
	});

	it("defaults observe to metadata scope, and to selector when one is given", async () => {
		document.body.innerHTML = '<p id="target">hello world</p>';

		const metadata = await handleCoAgentContentCommand(
			request({ type: "co-agent:observe" }),
			context(),
		);
		expect(metadata.success && metadata.snapshot?.text).toBeUndefined();

		const selector = await handleCoAgentContentCommand(
			request({ type: "co-agent:observe", selector: "#target" }),
			context(),
		);
		expect(selector.success && selector.element?.tagName).toBe("p");
	});

	it("returns matching elements for query", async () => {
		document.body.innerHTML =
			'<a href="/a">one</a><a href="/b">two</a><span>no</span>';
		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:query", selector: "a" }),
			context(),
		);
		expect(response.success && response.elements).toHaveLength(2);
	});

	it("clicks a safe target", async () => {
		document.body.innerHTML = '<button type="button">Show more</button>';
		const clicked = vi.fn();
		document.querySelector("button")?.addEventListener("click", clicked);

		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "button" }),
			context(),
		);
		expect(response.success).toBe(true);
		expect(clicked).toHaveBeenCalledTimes(1);
	});

	it("reports a blocked click as success-with-blocked, and does not click", async () => {
		document.body.innerHTML = '<button type="button">Delete account</button>';
		const clicked = vi.fn();
		document.querySelector("button")?.addEventListener("click", clicked);

		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "button" }),
			context(),
		);
		// Deliberately not an error: the model is meant to read `blocked` and ask
		// the user to act, not to treat this as a failure and retry.
		expect(response.success).toBe(true);
		expect(response.success && response.blocked).toBe(true);
		expect(response.success && response.requiresUserAction).toBe(true);
		expect(clicked).not.toHaveBeenCalled();
	});

	it("types into a safe field and leaves a sensitive one alone", async () => {
		document.body.innerHTML =
			'<input id="note" type="text" name="note" /><input id="pw" type="text" name="password" />';

		const ok = await handleCoAgentContentCommand(
			request({ type: "co-agent:input", selector: "#note", value: "typed" }),
			context(),
		);
		expect(ok.success).toBe(true);
		expect(document.querySelector<HTMLInputElement>("#note")?.value).toBe(
			"typed",
		);

		const blocked = await handleCoAgentContentCommand(
			request({ type: "co-agent:input", selector: "#pw", value: "hunter2" }),
			context(),
		);
		expect(blocked.success && blocked.blocked).toBe(true);
		expect(document.querySelector<HTMLInputElement>("#pw")?.value).toBe("");
	});

	it("honours the first-party policy for the app's own UI", async () => {
		document.body.innerHTML = '<button type="button">Delete note</button>';
		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "button" }),
			context({ safety: "first-party" }),
		);
		expect(response.success && response.blocked).toBeFalsy();
	});

	it("turns a missing element into an error response rather than throwing", async () => {
		const response = await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "#nope" }),
			context(),
		);
		expect(response.success).toBe(false);
	});

	it("records every command in the trace, including blocked and failed ones", async () => {
		document.body.innerHTML = '<button type="button">Delete account</button>';
		await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "button" }),
			context(),
		);
		await handleCoAgentContentCommand(
			request({ type: "co-agent:click", selector: "#nope" }),
			context(),
		);

		const trace = await handleCoAgentContentCommand(
			request({ type: "co-agent:get-trace" }),
			context(),
		);
		expect(trace.success).toBe(true);
		const steps = trace.success ? (trace.trace ?? []) : [];
		expect(steps.length).toBeGreaterThanOrEqual(2);
		expect(steps.some((step) => step.blocked === true)).toBe(true);
	});

	it("narrates status so the dock can follow along", async () => {
		const messages: string[] = [];
		window.addEventListener(CO_AGENT_STATUS_EVENT, (event) => {
			messages.push((event as CustomEvent<{ message: string }>).detail.message);
		});
		document.body.innerHTML = "<p>hi</p>";
		await handleCoAgentContentCommand(
			request({ type: "co-agent:observe" }),
			context(),
		);
		expect(messages).toContain(texts.observingPage);
		expect(messages).toContain(texts.done);
	});
});
