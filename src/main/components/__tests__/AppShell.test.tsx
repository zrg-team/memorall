import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * On a narrow screen the workspace page opens over the chat. It used to be
 * mounted twice — once in the desktop panel, hidden by CSS, and once in the
 * overlay — so every poll, listener and filesystem scan of the page ran twice.
 */

const mocks = vi.hoisted(() => ({ narrow: true }));

vi.mock("@/main/hooks/use-viewport", () => ({
	useMediaQuery: (query: string) =>
		query === "(max-width: 640px)" ? mocks.narrow : false,
}));
vi.mock("@/main/components/RightApplicationLayout", () => ({
	RightApplicationLayout: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("@/main/components/MainWorkspacePanel", () => ({
	MainWorkspacePanel: () => null,
}));
vi.mock("@/main/modules/chat/components", () => ({
	useCurrentModel: () => ({ isInitialized: true }),
}));
vi.mock("@/main/modules/llm/components", () => ({
	ModelDownloadingScreen: () => null,
	useDownloadProgress: () => ({
		downloadProgress: { percent: 0 },
		quickDownloadModel: null,
	}),
}));
vi.mock("@/main/stores/runtime-sessions", () => ({
	useRuntimeSessionsStore: (select: (state: unknown) => unknown) =>
		select({ getRuntimeCount: () => 0, refresh: async () => {} }),
}));
vi.mock("@/utils/open-standalone", () => ({ openStandalonePage: vi.fn() }));

import { AppShell } from "../AppShell";

const page = () => (
	<MemoryRouter initialEntries={["/files"]}>
		<AppShell>
			<div data-testid="workspace-page" />
		</AppShell>
	</MemoryRouter>
);

afterEach(cleanup);

describe("AppShell's workspace page", () => {
	it("is mounted once on a narrow screen, in the overlay", () => {
		mocks.narrow = true;
		render(page());
		expect(screen.getAllByTestId("workspace-page")).toHaveLength(1);
		expect(
			screen.getByTestId("workspace-page").closest("section")?.className,
		).toContain("fixed");
	});

	it("is mounted once on a wide screen, in the side panel", () => {
		mocks.narrow = false;
		render(page());
		expect(screen.getAllByTestId("workspace-page")).toHaveLength(1);
		expect(
			screen.getByTestId("workspace-page").closest("section")?.dataset.copilot,
		).toBe("right-panel");
	});

	it("keeps the page, and what it holds, when the width crosses the breakpoint", () => {
		const mounts = vi.fn();
		const Page = () => {
			const [text] = React.useState(() => {
				mounts();
				return "draft";
			});
			return <div data-testid="workspace-page">{text}</div>;
		};
		const shell = () => (
			<MemoryRouter initialEntries={["/files"]}>
				<AppShell>
					<Page />
				</AppShell>
			</MemoryRouter>
		);

		mocks.narrow = false;
		const view = render(shell());
		mocks.narrow = true;
		view.rerender(shell());
		mocks.narrow = false;
		view.rerender(shell());

		expect(mounts).toHaveBeenCalledTimes(1);
		expect(screen.getAllByTestId("workspace-page")).toHaveLength(1);
	});
});
