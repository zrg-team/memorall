import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoAgentOverlay } from "@/co-agent/dom/overlay";
import {
	CO_AGENT_CONTAINER_ID,
	CO_AGENT_STATUS_EVENT,
} from "@/co-agent/constants";
import { buildSnapshot } from "@/co-agent/dom/dom-utils";

/**
 * The visible half of the co-agent. Without it the agent still clicks and types,
 * but the user cannot see it happening, which is the entire difference between a
 * co-agent and unattended automation.
 */

const AGENT_CURSOR_EVENT = "memorall:agent-cursor";

let dispose: (() => void) | null = null;

const shadow = () =>
	document.getElementById(CO_AGENT_CONTAINER_ID)?.shadowRoot ?? null;

const emitCursor = (detail: Record<string, unknown>) =>
	window.dispatchEvent(new CustomEvent(AGENT_CURSOR_EVENT, { detail }));

const emitStatus = (message: string) =>
	window.dispatchEvent(
		new CustomEvent(CO_AGENT_STATUS_EVENT, { detail: { message } }),
	);

beforeEach(() => {
	document.body.innerHTML = "";
});

afterEach(() => {
	dispose?.();
	dispose = null;
	document.getElementById(CO_AGENT_CONTAINER_ID)?.remove();
});

describe("co-agent overlay", () => {
	it("mounts inside a shadow root so the page cannot style it", () => {
		dispose = createCoAgentOverlay();
		const host = document.getElementById(CO_AGENT_CONTAINER_ID);
		expect(host).not.toBeNull();
		expect(host?.shadowRoot).not.toBeNull();
	});

	it("stays out of the snapshot the agent reads back", () => {
		document.body.innerHTML = "<p>real page text</p>";
		dispose = createCoAgentOverlay();
		emitStatus("Observing this page");

		const snapshot = buildSnapshot({
			includePageText: true,
			includeVisibleText: true,
			includeDomSummary: true,
			maxDomElements: 50,
		});

		// Otherwise the model reads its own status bubble back as page content and
		// starts describing itself.
		const serialised = JSON.stringify(snapshot);
		expect(serialised).toContain("real page text");
		expect(serialised).not.toContain("Observing this page");
		expect(snapshot.domSummary?.some((el) => el.tagName === "svg")).toBeFalsy();
	});

	it("shows the status message the command handler narrates", () => {
		dispose = createCoAgentOverlay();
		emitStatus("Checking whether I can click");
		const dock = shadow()?.querySelector(".dock");
		expect(dock?.textContent).toContain("Checking whether I can click");
		expect(dock?.className).toContain("is-visible");
	});

	it("points the cursor at the element the agent moved to", async () => {
		document.body.innerHTML = '<button id="go" type="button">Go</button>';
		dispose = createCoAgentOverlay();

		emitCursor({ selector: "#go", message: "Click target", mode: "jumpTo" });
		await new Promise((resolve) => setTimeout(resolve, 10));

		const cursor = shadow()?.querySelector(".cursor") as HTMLElement | null;
		const label = shadow()?.querySelector(".label") as HTMLElement | null;
		expect(cursor?.style.opacity).toBe("1");
		expect(label?.textContent).toBe("Click target");
	});

	it("ignores a target that is not on the page", async () => {
		dispose = createCoAgentOverlay();
		emitCursor({ selector: "#missing", mode: "jumpTo" });
		await new Promise((resolve) => setTimeout(resolve, 10));
		const cursor = shadow()?.querySelector(".cursor") as HTMLElement | null;
		expect(cursor?.style.opacity).not.toBe("1");
	});

	it("hides on request", async () => {
		document.body.innerHTML = '<button id="go" type="button">Go</button>';
		dispose = createCoAgentOverlay();
		emitCursor({ selector: "#go", mode: "jumpTo" });
		await new Promise((resolve) => setTimeout(resolve, 10));

		emitCursor({ hide: true });
		const cursor = shadow()?.querySelector(".cursor") as HTMLElement | null;
		expect(cursor?.style.opacity).toBe("0");
	});

	it("renders no cursor inside Memorall's own window", async () => {
		document.body.innerHTML = '<button id="go" type="button">Go</button>';
		// App.tsx already mounts the React cursor there; a second one would draw
		// two pointers chasing the same target.
		dispose = createCoAgentOverlay({ cursor: false, status: true });

		expect(shadow()?.querySelector(".cursor")).toBeNull();
		expect(shadow()?.querySelector(".dock")).not.toBeNull();

		emitCursor({ selector: "#go", mode: "jumpTo" });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(shadow()?.querySelector(".cursor")).toBeNull();
	});

	it("mounts only once however often it is asked", () => {
		dispose = createCoAgentOverlay();
		createCoAgentOverlay();
		expect(document.querySelectorAll(`#${CO_AGENT_CONTAINER_ID}`)).toHaveLength(
			1,
		);
	});

	it("removes itself and stops listening when disposed", () => {
		const teardown = createCoAgentOverlay();
		teardown();
		expect(document.getElementById(CO_AGENT_CONTAINER_ID)).toBeNull();
		// Must not throw now that the host is gone.
		expect(() => emitStatus("late")).not.toThrow();
	});
});
