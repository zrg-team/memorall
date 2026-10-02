import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const focusSession = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/main/i18n/config", () => ({}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/services", () => ({
	serviceManager: {
		getWebBrowserService: () => ({ focusSession }),
	},
}));
vi.mock("@/platform/current", () => ({
	platform: { externalLinks: { open: vi.fn() } },
}));

import type { ActiveWebSessionInfo } from "../types";
import { WebBrowserSessionCard } from "../WebBrowserSessionCard";

const session = (mode: ActiveWebSessionInfo["mode"]) =>
	({
		isOpen: true,
		sessionId: "s1",
		mode,
		title: "Listing",
		currentUrl: "https://batdongsan.com.vn/listing",
	}) as ActiveWebSessionInfo;

const SHOW = "sandboxPanel.openControlledWindow";

describe("a web session's card", () => {
	beforeEach(() => focusSession.mockClear());

	it("brings the agent's window forward for the user", async () => {
		render(
			<WebBrowserSessionCard session={session("window")} onChanged={vi.fn()} />,
		);
		fireEvent.click(screen.getByTitle(SHOW));
		await waitFor(() => expect(focusSession).toHaveBeenCalledWith("s1"));
	});

	it("offers it for a tab, but not for an embedded page", () => {
		const { rerender } = render(
			<WebBrowserSessionCard session={session("tab")} onChanged={vi.fn()} />,
		);
		expect(screen.queryByTitle(SHOW)).toBeTruthy();
		rerender(
			<WebBrowserSessionCard session={session("iframe")} onChanged={vi.fn()} />,
		);
		expect(screen.queryByTitle(SHOW)).toBeNull();
	});
});
