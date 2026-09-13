import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	statusOf: (): string => "connected",
	toolsOf: () => [],
	toolCache: {} as Record<string, unknown>,
	discovering: [] as string[],
	localServers: {} as Record<string, unknown>,
	discover: vi.fn(),
	save: vi.fn(),
	remove: vi.fn(),
	approveLocalServer: vi.fn(),
	refreshLocalServers: vi.fn(async () => undefined),
	stopLocalServer: vi.fn(),
	restartLocalServer: vi.fn(),
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

const localServer: McpConnection = {
	id: "local-files",
	kind: "template",
	name: "Project files",
	transport: "stdio",
	url: "",
	authMode: "none",
	stdio: {
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "/work"],
		env: { LOG_LEVEL: "debug" },
		secretEnvKeys: ["API_TOKEN"],
		templateId: "filesystem",
	},
	enabledByDefault: true,
	createdAt: "2026-08-17T00:00:00.000Z",
	updatedAt: "2026-08-17T00:00:00.000Z",
};

beforeEach(() => {
	storeState.statusOf = () => "connected";
	storeState.approveLocalServer.mockReset();
});

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

	describe("a local server", () => {
		const commandLine =
			"npx -y @modelcontextprotocol/server-filesystem@2026.8.31 /work";

		it("is described by the command it runs, not an empty URL", () => {
			render(<ConnectionDetail connection={localServer} />);

			expect(screen.getByText(commandLine)).toBeInTheDocument();
			expect(screen.getByText("detail.tabs.process")).toBeInTheDocument();
			expect(screen.queryByText("detail.tabs.apps")).not.toBeInTheDocument();
		});

		it("never shows secret values in its settings", () => {
			render(<ConnectionDetail connection={localServer} />);
			screen.getByText("detail.tabs.settings").click();

			return screen.findByText("LOG_LEVEL, API_TOKEN (••••)").then((env) => {
				expect(env).toBeInTheDocument();
				expect(screen.queryByText("custom.authLabel")).not.toBeInTheDocument();
			});
		});

		it("asks for approval, showing the exact command, before it may run", () => {
			storeState.statusOf = () => "needs-approval";
			render(<ConnectionDetail connection={localServer} />);

			expect(
				screen.getByText("template.needsApprovalHint"),
			).toBeInTheDocument();
			expect(screen.getAllByText(commandLine).length).toBeGreaterThan(1);
			screen.getByRole("button", { name: "template.approve" }).click();
			expect(storeState.approveLocalServer).toHaveBeenCalledWith("local-files");
		});

		it("explains a missing runtime instead of a raw error", () => {
			storeState.statusOf = () => "runtime-missing";
			render(<ConnectionDetail connection={localServer} />);

			expect(
				screen.getByText("template.runtimeMissingHint"),
			).toBeInTheDocument();
		});
	});
});
