import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonBrowserState } from "@/services/memon/types";
import { BrowserWindow } from "../windows/BrowserWindow";

// Embedded pages bring the whole service layer; these tabs are real ones.
vi.mock("../windows/EmbeddedPage", () => ({ EmbeddedPage: () => null }));

const browser = (wallTabId?: string): MemonBrowserState => ({
	tabs: [
		{
			id: "tab1",
			sessionId: "s1",
			url: "https://shop.test/",
			title: "Just a moment...",
			outline: null,
			history: ["https://shop.test/"],
			historyIndex: 0,
			wall: {
				kind: "cloudflare",
				description:
					"The site served a Cloudflare verification page instead of the content.",
			},
		},
	],
	activeTabId: "tab1",
	...(wallTabId ? { wallTabId } : {}),
});

const setup = (state: MemonBrowserState) => {
	const send = vi.fn(async () => undefined);
	render(
		<BrowserWindow machineKey="k" browser={state} servers={[]} send={send} />,
	);
	return { send, notice: screen.getByRole("alert") };
};

describe("a page that needs a person", () => {
	it("asks the user to solve it while the agent waits, and checks again on Done", () => {
		const { send, notice } = setup(browser("tab1"));

		expect(notice).toHaveTextContent("memonComputer.wall.title");
		expect(notice).toHaveTextContent("memonComputer.wall.waiting");
		fireEvent.click(
			within(notice).getByRole("button", { name: "memonComputer.wall.show" }),
		);
		fireEvent.click(
			within(notice).getByRole("button", { name: "memonComputer.wall.done" }),
		);
		fireEvent.click(
			within(notice).getByRole("button", { name: "memonComputer.wall.ignore" }),
		);

		expect(send).toHaveBeenNthCalledWith(1, "browser.show", { key: "k" });
		expect(send).toHaveBeenNthCalledWith(2, "browser.recheckWall", {
			key: "k",
		});
		expect(send).toHaveBeenNthCalledWith(3, "browser.continuePastWall", {
			key: "k",
		});
	});

	it("only says what the page needs when the agent is not stopped on it", () => {
		const { notice } = setup(browser());

		expect(notice).toHaveTextContent("memonComputer.wall.idle");
		expect(notice).not.toHaveTextContent("memonComputer.wall.waiting");
	});
});
