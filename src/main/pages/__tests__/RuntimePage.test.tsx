import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
	listCommands: vi.fn(),
	listServers: vi.fn(),
	getActiveSessionInfo: vi.fn(),
	memonSummaries: {} as Record<string, { key: string; updatedAt: number }>,
	memonAgents: [] as Array<{ id: string; name: string }>,
	chatAgentId: null as string | null,
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
			currentConversation: { id: string } | null;
			selectedAgentFlowId: string | null;
		}) => unknown,
	) =>
		selector({
			messages: [],
			persistMessageContent: vi.fn(),
			currentConversation: { id: "conversation-1" },
			selectedAgentFlowId: runtimeMocks.chatAgentId,
		}),
}));

vi.mock("@/main/stores/memon-machine", () => ({
	useMemonMachineStore: (
		selector: (state: {
			summaries: typeof runtimeMocks.memonSummaries;
			snapshots: Record<string, never>;
			start: () => void;
		}) => unknown,
	) =>
		selector({
			summaries: runtimeMocks.memonSummaries,
			snapshots: {},
			start: () => {},
		}),
}));

vi.mock("@/main/components/molecules/MemonComputer", () => ({
	MemonComputerPanel: ({
		machineKey,
		emptyState,
	}: {
		machineKey: string | null;
		emptyState?: React.ReactNode;
	}) => (machineKey ? `computer:${machineKey}` : emptyState),
	MemonComputerStart: ({ agents }: { agents: Array<{ name: string }> }) =>
		`start:${agents.map((agent) => agent.name).join(",")}`,
	useMemonAgents: () => ({ agents: runtimeMocks.memonAgents, loading: false }),
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

vi.mock("@/main/modules/chat/components/artifacts/artifact-protocol", () => ({
	collectRuntimeArtifacts: () => [],
	replaceArtifactContent: vi.fn(),
}));

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
// It reads images from Files, which would start the filesystem in jsdom.
vi.mock("@/main/modules/chat/components/artifacts/HtmlArtifactFrame", () => ({
	HtmlArtifactFrame: () => null,
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
		runtimeMocks.memonSummaries = {};
		runtimeMocks.memonAgents = [];
		runtimeMocks.chatAgentId = null;
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
		render(
			<MemoryRouter>
				<RuntimePage />
			</MemoryRouter>,
		);

		expect(await screen.findByText(":4173")).toBeVisible();
		expect(runtimeMocks.listCommands).toHaveBeenCalled();
		expect(runtimeMocks.listServers).toHaveBeenCalled();
		expect(runtimeMocks.getActiveSessionInfo).toHaveBeenCalled();
	});

	it("opens the Computer tab for the conversation's machine when asked", async () => {
		runtimeMocks.memonSummaries = {
			"conversation-1": { key: "conversation-1", updatedAt: 1 },
		};
		render(
			<MemoryRouter
				initialEntries={[
					{ pathname: "/runtime", state: { section: "computer" } },
				]}
			>
				<RuntimePage />
			</MemoryRouter>,
		);

		expect(await screen.findByText("computer:conversation-1")).toBeVisible();
		expect(screen.getByRole("tab", { name: "Computer" })).toBeVisible();
	});

	it("offers to start a computer when the chat's agent has MemonOS Bot", async () => {
		runtimeMocks.memonAgents = [{ id: "agent-1", name: "Researcher" }];
		runtimeMocks.chatAgentId = "agent-1";
		render(
			<MemoryRouter>
				<RuntimePage />
			</MemoryRouter>,
		);

		expect(await screen.findByText("start:Researcher")).toBeVisible();
		expect(screen.getByRole("tab", { name: "Computer" })).toBeVisible();
		expect(screen.getByRole("tab", { name: "Live Runtime" })).toBeVisible();
	});

	it("keeps Live Runtime first when the chat's agent has no MemonOS Bot", async () => {
		runtimeMocks.memonAgents = [{ id: "agent-1", name: "Researcher" }];
		runtimeMocks.chatAgentId = "agent-2";
		render(
			<MemoryRouter>
				<RuntimePage />
			</MemoryRouter>,
		);

		expect(await screen.findByText(":4173")).toBeVisible();
		expect(screen.getByRole("tab", { name: "Computer" })).toBeVisible();
	});
});
