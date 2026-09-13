import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnection } from "@/services/mcp-connections";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFileAsBase64: vi.fn(async () => "") },
}));

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

const storeState = vi.hoisted(() => ({
	status: "connected" as string,
	localServers: {} as Record<string, unknown>,
	discovering: [] as string[],
	refreshLocalServers: vi.fn(async () => undefined),
	discover: vi.fn(async () => undefined),
	stopLocalServer: vi.fn(async () => undefined),
	restartLocalServer: vi.fn(async () => undefined),
}));

vi.mock("@/main/stores/connections", () => ({
	useConnectionsStore: (
		selector: (
			state: typeof storeState & { statusOf: () => string },
		) => unknown,
	) => selector({ ...storeState, statusOf: () => storeState.status }),
}));

import { LocalServerRuntimePanel } from "../LocalServerRuntimePanel";

const connection: McpConnection = {
	id: "local-1",
	kind: "template",
	name: "Time",
	transport: "stdio",
	url: "",
	authMode: "none",
	stdio: { command: "uvx", args: ["mcp-server-time==2026.8.18"] },
	enabledByDefault: true,
	createdAt: "2026-08-17T00:00:00.000Z",
	updatedAt: "2026-08-17T00:00:00.000Z",
};

const runtime = (state: string, extra: Record<string, unknown> = {}) => ({
	approved: true,
	status: {
		id: "local-1",
		state,
		pid: state === "running" ? 4242 : null,
		startedAt: state === "running" ? "2026-08-17T00:00:00.000Z" : null,
		lastError: null,
		fingerprint: "f",
		logTail: ["$ uvx mcp-server-time==2026.8.18", "server ready"],
		...extra,
	},
});

beforeEach(() => {
	storeState.status = "connected";
	storeState.localServers = {};
	for (const key of [
		"refreshLocalServers",
		"discover",
		"stopLocalServer",
		"restartLocalServer",
	] as const) {
		storeState[key].mockClear();
	}
});

describe("LocalServerRuntimePanel", () => {
	it("shows a running server's pid and log, and stops it", () => {
		storeState.localServers = { "local-1": runtime("running") };
		render(<LocalServerRuntimePanel connection={connection} />);

		expect(screen.getByText("template.pid")).toBeInTheDocument();
		expect(screen.getByText(/server ready/)).toBeInTheDocument();
		expect(storeState.refreshLocalServers).toHaveBeenCalled();

		fireEvent.click(screen.getByText("template.stop"));
		expect(storeState.stopLocalServer).toHaveBeenCalledWith("local-1");
	});

	it("restarts a running server", () => {
		storeState.localServers = { "local-1": runtime("running") };
		render(<LocalServerRuntimePanel connection={connection} />);

		fireEvent.click(screen.getByText("template.restart"));
		expect(storeState.restartLocalServer).toHaveBeenCalledWith("local-1");
	});

	it("starts a stopped server and says it would start on its own anyway", () => {
		storeState.status = "stopped";
		storeState.localServers = { "local-1": runtime("stopped") };
		render(<LocalServerRuntimePanel connection={connection} />);

		expect(screen.getByText("template.stoppedHint")).toBeInTheDocument();
		fireEvent.click(screen.getByText("template.start"));
		expect(storeState.discover).toHaveBeenCalledWith("local-1");
	});

	it("restarts a crashed server rather than re-using its held state", () => {
		storeState.status = "error";
		storeState.localServers = {
			"local-1": runtime("exited", { lastError: "The server process exited." }),
		};
		render(<LocalServerRuntimePanel connection={connection} />);

		fireEvent.click(screen.getByText("template.start"));
		expect(storeState.restartLocalServer).toHaveBeenCalledWith("local-1");
	});

	it("will not start a server that still needs approval", () => {
		storeState.status = "needs-approval";
		render(<LocalServerRuntimePanel connection={connection} />);

		expect(
			screen.getByRole("button", { name: /template.start/ }),
		).toBeDisabled();
	});
});
