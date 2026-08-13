import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	listCommands: vi.fn(),
	listServers: vi.fn(),
	getActiveSessionInfo: vi.fn(),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		getSandboxContainerService: () => ({
			listCommands: runtimeMocks.listCommands,
			listServers: runtimeMocks.listServers,
		}),
		getWebBrowserService: () => ({
			getActiveSessionInfo: runtimeMocks.getActiveSessionInfo,
		}),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

vi.mock("@/main/stores/chat", () => ({
	useChatStore: (
		selector: (state: {
			messages: never[];
			persistMessageContent: ReturnType<typeof vi.fn>;
		}) => unknown,
	) =>
		selector({
			messages: [],
			persistMessageContent: vi.fn(),
		}),
}));

vi.mock(
	"@/main/components/molecules/RuntimeSessions/RuntimeSessionsSectionList",
	() => ({
		RuntimeSessionsSectionList: ({
			servers,
		}: {
			servers: Array<{ port: number }>;
		}) => servers.map((server) => `:${server.port}`).join(", "),
	}),
);

vi.mock(
	"@/main/modules/chat/components/artifacts/artifact-protocol",
	() => ({
		collectRuntimeArtifacts: () => [],
		replaceArtifactContent: vi.fn(),
	}),
);

vi.mock("@/main/modules/chat/components/MarkdownMessage", () => ({
	default: () => null,
}));
vi.mock("@/main/modules/chat/components/artifacts/ArtifactRenderer", () => ({
	UrlArtifact: () => null,
}));
vi.mock("@/main/modules/chat/components/artifacts/HyperframesArtifact", () => ({
	HyperframesArtifact: () => null,
}));
vi.mock("@/main/modules/chat/components/artifacts/LottieArtifact", () => ({
	LottieArtifact: () => null,
}));

import { RuntimePage } from "../RuntimePage";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";

describe("RuntimePage", () => {
	beforeEach(() => {
		runtimeMocks.listCommands.mockResolvedValue({ commands: [] });
		runtimeMocks.listServers.mockResolvedValue({
			servers: [
				{
					kind: "express",
					port: 4173,
					url: "http://127.0.0.1:4173",
					renderUrl: "chrome-extension://test/sandbox/?port=4173",
					rootDir: "/projects/sandbox-e2e",
				},
			],
		});
		runtimeMocks.getActiveSessionInfo.mockResolvedValue({ isOpen: false });
		useRuntimeSessionsStore.setState({
			commands: [],
			servers: [],
			activeWebSession: { isOpen: false },
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("refreshes and renders an existing server when mounted", async () => {
		render(<RuntimePage />);

		expect(await screen.findByText(":4173")).toBeVisible();
		expect(runtimeMocks.listCommands).toHaveBeenCalled();
		expect(runtimeMocks.listServers).toHaveBeenCalled();
		expect(runtimeMocks.getActiveSessionInfo).toHaveBeenCalled();
	});
});
