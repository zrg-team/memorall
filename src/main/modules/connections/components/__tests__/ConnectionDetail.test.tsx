import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { McpConnection } from "@/services/mcp-connections";
import { ConnectionDetail } from "../ConnectionDetail";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFileAsBase64: vi.fn(async () => "") },
}));

// Reaching the connections registry pulls the tool catalogue, and with it
// pdfjs, which wants a canvas jsdom has not got. Nothing here renders a PDF.
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({ promise: Promise.resolve(null) }),
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
		paintJpegXObject: 4,
	},
}));

const storeState = {
	statusOf: () => "connected" as const,
	toolsOf: () => [],
	toolCache: {} as Record<string, unknown>,
	discovering: [] as string[],
	discover: vi.fn(),
	save: vi.fn(),
	remove: vi.fn(),
};

vi.mock("@/main/stores/connections", () => ({
	useConnectionsStore: (selector: (state: typeof storeState) => unknown) =>
		selector(storeState),
}));

const composio: McpConnection = {
	id: "composio",
	kind: "composio",
	name: "Composio",
	transport: "http",
	url: "https://backend.composio.dev/tool_router/trs_x/mcp",
	authMode: "header",
	apps: [
		{ id: "googlecalendar", name: "Google Calendar", status: "active" },
		{ id: "github", name: "GitHub", status: "active" },
		{ id: "gmail", name: "Gmail", status: "active" },
	],
	composio: { toolkits: ["googlecalendar", "github", "gmail"] },
	enabledByDefault: false,
	createdAt: "2026-08-17T00:00:00.000Z",
	updatedAt: "2026-08-17T00:00:00.000Z",
};

const custom: McpConnection = {
	id: "acme",
	kind: "custom",
	name: "acme-internal",
	transport: "http",
	url: "http://localhost:8809/mcp",
	authMode: "none",
	enabledByDefault: false,
	createdAt: "2026-08-17T00:00:00.000Z",
	updatedAt: "2026-08-17T00:00:00.000Z",
};

describe("ConnectionDetail", () => {
	it("opens a Composio credential on the apps it holds", () => {
		render(<ConnectionDetail connection={composio} />);

		expect(screen.getByText("Google Calendar")).toBeInTheDocument();
		expect(screen.getByText("GitHub")).toBeInTheDocument();
		expect(screen.getByText("Gmail")).toBeInTheDocument();
		expect(screen.getByText("detail.appCount")).toBeInTheDocument();
	});

	it("offers a way to connect another app", () => {
		const onContinueSetup = vi.fn();
		render(
			<ConnectionDetail
				connection={composio}
				onContinueSetup={onContinueSetup}
			/>,
		);

		screen.getByRole("button", { name: /detail.connectMoreApps/ }).click();
		expect(onContinueSetup).toHaveBeenCalled();
	});

	it("says so plainly when a credential holds no apps", () => {
		render(<ConnectionDetail connection={{ ...composio, apps: [] }} />);

		expect(screen.getByText("detail.appsNoneHint")).toBeInTheDocument();
	});

	it("has no apps tab for a plain endpoint, which has none", () => {
		render(<ConnectionDetail connection={custom} />);

		expect(screen.queryByText("detail.tabs.apps")).not.toBeInTheDocument();
		expect(screen.getByText("detail.tabs.tools")).toBeInTheDocument();
	});
});
