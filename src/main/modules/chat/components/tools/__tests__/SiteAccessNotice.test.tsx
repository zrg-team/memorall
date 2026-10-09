import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostAccess = vi.hoisted(() => ({
	has: vi.fn(async (_origins: string[]) => false),
	request: vi.fn(async (_origins: string[]) => true),
	onChange: vi.fn((_listener: () => void) => () => {}),
}));

vi.mock("@/platform/current", () => ({
	platform: { environment: "extension", hostAccess },
}));

import { useWebChallengeHandoffStore } from "@/main/stores/web-challenge-handoff";
import { SiteAccessBanner } from "../../SiteAccessBanner";
import { SiteAccessNotice } from "../SiteAccessNotice";

describe("withheld site access in the chat", () => {
	beforeEach(() => {
		hostAccess.has.mockResolvedValue(false);
		hostAccess.request.mockResolvedValue(true);
		useWebChallengeHandoffStore.setState({ pendingContinuation: null });
	});

	it("asks for every site, then lets the agent carry on", async () => {
		render(<SiteAccessNotice />);

		fireEvent.click(
			await screen.findByRole("button", { name: /siteAccess\.allow/ }),
		);

		await screen.findByText("siteAccess.granted");
		expect(hostAccess.request).toHaveBeenCalledWith(["*://*/*"]);
		expect(useWebChallengeHandoffStore.getState().pendingContinuation).toBe(
			"siteAccess.continuePrompt",
		);
	});

	it("says what to do when the browser declines, and does not continue", async () => {
		hostAccess.request.mockResolvedValue(false);
		render(<SiteAccessNotice />);

		fireEvent.click(
			await screen.findByRole("button", { name: /siteAccess\.allow/ }),
		);

		await screen.findByText("siteAccess.declined");
		expect(useWebChallengeHandoffStore.getState().pendingContinuation).toBe(
			null,
		);
	});

	it("stays out of the way when access is already granted", async () => {
		hostAccess.has.mockResolvedValue(true);
		render(
			<>
				<SiteAccessNotice />
				<SiteAccessBanner />
			</>,
		);

		await waitFor(() => expect(hostAccess.has).toHaveBeenCalled());
		expect(screen.queryByTestId("site-access-notice")).toBeNull();
		expect(screen.queryByTestId("site-access-banner")).toBeNull();
	});

	it("hides the banner once the browser grants access elsewhere", async () => {
		let notify = () => {};
		hostAccess.onChange.mockImplementation((listener: () => void) => {
			notify = listener;
			return () => {};
		});
		render(<SiteAccessBanner />);
		await screen.findByTestId("site-access-banner");

		hostAccess.has.mockResolvedValue(true);
		await act(async () => notify());

		await waitFor(() =>
			expect(screen.queryByTestId("site-access-banner")).toBeNull(),
		);
	});
});
