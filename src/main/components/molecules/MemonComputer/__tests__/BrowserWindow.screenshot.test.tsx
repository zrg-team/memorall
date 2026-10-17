import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemonBrowserState } from "@/services/memon/types";

const calls = vi.hoisted(() => [] as string[]);
const hostAccess = vi.hoisted(() => ({
	has: vi.fn(async (_origins: string[]) => true),
	request: vi.fn(async (_origins: string[]) => {
		calls.push("request");
		return true;
	}),
	onChange: vi.fn((_listener: () => void) => () => {}),
}));

vi.mock("@/platform/current", () => ({
	platform: { environment: "extension", hostAccess },
}));
vi.mock("../windows/EmbeddedPage", () => ({ EmbeddedPage: () => null }));

import { BrowserWindow } from "../windows/BrowserWindow";

const browser = (
	extra: Partial<MemonBrowserState> = {},
	kind?: "embedded",
): MemonBrowserState => ({
	tabs: [
		{
			id: "tab1",
			sessionId: "s1",
			url: kind ? "http://localhost:3000/" : "https://example.com/",
			title: "Example",
			outline: null,
			history: [],
			historyIndex: 0,
			...(kind ? { kind } : {}),
		},
	],
	activeTabId: "tab1",
	...extra,
});

const sender = () =>
	vi.fn(async (operation: string) => {
		calls.push(operation);
	});

const view = (state: MemonBrowserState, send = sender()) => (
	<BrowserWindow
		machineKey="k"
		home="/agents/Bot"
		browser={state}
		servers={[]}
		send={send}
	/>
);

/** Radix opens its menus on a primary-button pointer press. */
const shoot = async (item: "screenshotView" | "screenshotFullPage") => {
	fireEvent.pointerDown(
		screen.getByRole("button", { name: "memonComputer.browser.screenshot" }),
		{ button: 0, ctrlKey: false, pointerType: "mouse" },
	);
	fireEvent.click(
		await screen.findByRole("menuitem", {
			name: `memonComputer.browser.${item}`,
		}),
	);
};

beforeEach(() => {
	calls.length = 0;
	hostAccess.request.mockClear();
});

describe("screenshots in the Browser", () => {
	it("asks for screenshots inside the click, before taking one of a real tab", async () => {
		const send = sender();
		render(view(browser(), send));

		await shoot("screenshotView");

		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("browser.screenshot", { key: "k" }),
		);
		expect(hostAccess.request).toHaveBeenCalledWith(["<all_urls>"]);
		expect(calls).toEqual(["request", "browser.screenshot"]);
	});

	it("takes the whole page, top to bottom", async () => {
		const send = sender();
		render(view(browser(), send));

		await shoot("screenshotFullPage");

		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("browser.screenshot", {
				key: "k",
				fullPage: true,
			}),
		);
		expect(calls).toEqual(["request", "browser.screenshot"]);
	});

	it("takes one of an embedded page without asking the browser", async () => {
		const send = sender();
		render(view(browser({}, "embedded"), send));

		await shoot("screenshotView");

		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("browser.screenshot", { key: "k" }),
		);
		expect(hostAccess.request).not.toHaveBeenCalled();
	});

	it("lets the user allow the screenshots the agent was refused", async () => {
		const send = sender();
		render(view(browser({ captureBlocked: true }), send));

		const bar = screen.getByTestId("memon-capture-access");
		expect(bar).toHaveTextContent("memonComputer.captureAccess.title");
		fireEvent.click(
			screen.getByRole("button", {
				name: /memonComputer\.captureAccess\.allow/,
			}),
		);

		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("browser.captureAllowed", {
				key: "k",
			}),
		);
		expect(hostAccess.request).toHaveBeenCalledWith(["<all_urls>"]);
	});

	it("says where a new screenshot went, and opens it from there", () => {
		const send = sender();
		const shot = {
			id: 1,
			path: "/agents/Bot/Pictures/example.com-2026-10-16-14-03-22.png",
			width: 1280,
			height: 800,
		};
		// One saved before the window opened is not news.
		const { rerender } = render(view(browser({ shot }), send));
		expect(screen.queryByTestId("memon-screenshot-saved")).toBeNull();

		rerender(view(browser({ shot: { ...shot, id: 2 } }), send));
		fireEvent.click(screen.getByTestId("memon-screenshot-saved"));

		expect(send).toHaveBeenCalledWith("files.open", {
			key: "k",
			path: shot.path,
		});
	});
});
