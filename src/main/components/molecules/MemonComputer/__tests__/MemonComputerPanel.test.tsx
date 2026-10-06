import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
// The windows (and the PDF, file and terminal code behind them) are not
// what this tests: the desktop is empty.
vi.mock("../windows/BrowserWindow", () => ({ BrowserWindow: () => null }));
vi.mock("../windows/EditorWindow", () => ({ EditorWindow: () => null }));
vi.mock("../windows/FilesWindow", () => ({ FilesWindow: () => null }));
vi.mock("../windows/TerminalWindow", () => ({ TerminalWindow: () => null }));
vi.mock("../windows/PiCodeWindow", () => ({ PiCodeWindow: () => null }));
vi.mock("../windows/ViewerWindow", () => ({ ViewerWindow: () => null }));
vi.mock("../windows/KitWindow", () => ({ KitWindow: () => null }));
vi.mock("../windows/VisualizeWindow", () => ({ VisualizeWindow: () => null }));
vi.mock("../use-export-downloads", () => ({
	useMemonExportDownloads: () => undefined,
}));

import { useMemonMachineStore } from "@/main/stores/memon-machine";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import type { MemonMachineSnapshot } from "@/services/memon/types";
import { MemonComputerPanel } from "../MemonComputerPanel";

const snapshot = {
	key: "agent-1",
	revision: 1,
	driver: "agent",
	status: "idle",
	apps: [],
	builtInApps: [],
	windows: [],
	focusedWindowId: null,
	browser: { tabs: [], activeTabId: null },
	files: { cwd: "/agents/Bot", entries: [] },
	editor: { path: null, content: "", saved: true, screenLine: 0 },
	viewer: { path: null, kind: null, text: "", loading: false, screenLine: 0 },
	tasks: { items: [] },
	scheduler: { agentId: null, items: [], loading: false },
	studio: { tools: [], selected: null, runs: [], loading: false },
	skills: { agentId: null, items: [], open: null, loading: false },
	connections: {
		agentId: null,
		items: [],
		unlocked: true,
		selected: null,
		loading: false,
	},
	terminal: {
		cwd: "/agents/Bot",
		lines: [],
		runningProcessId: null,
		runningCommand: null,
		startedAt: null,
		lastOutputAt: null,
		lastExitCode: null,
		approval: null,
		tabs: [],
		activeTabId: "1",
		runningTabId: null,
	},
	cursor: null,
	desktop: [],
	pendingUserChanges: [],
	drafts: {},
	home: "/agents/Bot",
	visual: {
		path: null,
		title: "Untitled visual",
		source: "",
		theme: "shadcn",
		screenLine: 0,
	},
	updatedAt: 0,
} as unknown as MemonMachineSnapshot;

beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

describe("MemonComputerPanel in full screen", () => {
	beforeEach(() => {
		useMemonMachineStore.setState({
			snapshots: { "agent-1": snapshot },
			pull: vi.fn(async () => undefined),
			send: vi.fn(async () => undefined),
		});
		useShellLayoutStore.setState({
			chatThreadSlot: null,
			chatShellCollapsed: true,
		});
		useWorkspaceModeStore.getState().setMode("studio" as never);
	});

	it("opens the chat beside the computer, from the header's start", () => {
		render(<MemonComputerPanel machineKey="agent-1" />);
		// Not full screen: the chat column is there, so no button for it.
		expect(screen.queryByLabelText("memonComputer.showChat")).toBeNull();

		fireEvent.click(screen.getByLabelText("memonComputer.fullscreen"));
		fireEvent.click(screen.getByLabelText("memonComputer.showChat"));

		const panel = screen.getByLabelText("memonComputer.chatPanel");
		expect(useShellLayoutStore.getState().chatThreadSlot).toBe(panel);
		// The chat page draws the thread: it is made to be there.
		expect(useShellLayoutStore.getState().chatShellCollapsed).toBe(false);
		expect(useWorkspaceModeStore.getState().mode).toBe("chat");

		fireEvent.click(screen.getByLabelText("memonComputer.hideChat"));
		expect(screen.queryByLabelText("memonComputer.chatPanel")).toBeNull();
		expect(useShellLayoutStore.getState().chatThreadSlot).toBeNull();
	});

	it("closes the chat panel with full screen", () => {
		render(<MemonComputerPanel machineKey="agent-1" />);
		fireEvent.click(screen.getByLabelText("memonComputer.fullscreen"));
		fireEvent.click(screen.getByLabelText("memonComputer.showChat"));

		fireEvent.click(screen.getByLabelText("memonComputer.exitFullscreen"));
		expect(screen.queryByLabelText("memonComputer.chatPanel")).toBeNull();
		expect(useShellLayoutStore.getState().chatThreadSlot).toBeNull();
	});
});
