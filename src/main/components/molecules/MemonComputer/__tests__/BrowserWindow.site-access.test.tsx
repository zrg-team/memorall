import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemonBrowserState } from "@/services/memon/types";

const hostAccess = vi.hoisted(() => ({
	has: vi.fn(async (_origins: string[]) => false),
	request: vi.fn(async (_origins: string[]) => true),
	onChange: vi.fn((_listener: () => void) => () => {}),
}));

vi.mock("@/platform/current", () => ({
	platform: { environment: "extension", hostAccess },
}));
vi.mock("../windows/EmbeddedPage", () => ({ EmbeddedPage: () => null }));

import { BrowserWindow } from "../windows/BrowserWindow";

const browser = (kind?: "embedded"): MemonBrowserState => ({
	tabs: [
		{
			id: "tab1",
			sessionId: "s1",
			url: "https://batdongsan.com.vn/ban-nha-rieng-tp-ho-chi-minh",
			title: "",
			outline: null,
			history: [],
			historyIndex: 0,
			...(kind ? { kind } : {}),
		},
	],
	activeTabId: "tab1",
});

describe("the Browser when Memorall may not read web pages", () => {
	it("asks for every site and reads the page again once granted", async () => {
		const send = vi.fn(async () => undefined);
		render(
			<BrowserWindow
				machineKey="k"
				browser={browser()}
				servers={[]}
				send={send}
			/>,
		);

		const bar = await screen.findByTestId("memon-site-access");
		fireEvent.click(
			screen.getByRole("button", { name: /memonComputer\.siteAccess\.allow/ }),
		);

		await waitFor(() =>
			expect(send).toHaveBeenCalledWith("browser.refresh", { key: "k" }),
		);
		expect(hostAccess.request).toHaveBeenCalledWith(["*://*/*"]);
		expect(bar).toHaveTextContent("memonComputer.siteAccess.title");
	});

	it("leaves the computer's own embedded pages alone", async () => {
		render(
			<BrowserWindow
				machineKey="k"
				browser={browser("embedded")}
				servers={[]}
				send={vi.fn(async () => undefined)}
			/>,
		);

		await waitFor(() => expect(hostAccess.has).toHaveBeenCalled());
		expect(screen.queryByTestId("memon-site-access")).toBeNull();
	});
});
