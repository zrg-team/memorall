import { create } from "zustand";

export const SHELL_CHAT_WIDTH_MIN = 24;
export const SHELL_CHAT_WIDTH_DEFAULT = 28;
export const SHELL_CHAT_WIDTH_MAX = 60;
export const SHELL_RIGHT_PANEL_WIDTH_DEFAULT = 100 - SHELL_CHAT_WIDTH_DEFAULT;
export const COPILOT_WORKSPACE_FOCUS_CHAT_WIDTH = SHELL_CHAT_WIDTH_MIN;

interface ShellLayoutState {
	chatRailCollapsed: boolean;
	chatShellCollapsed: boolean;
	chatShellWidth: number;
	rightPanelCollapsed: boolean;
	mobileChatListOpen: boolean;
	setChatRailCollapsed: (collapsed: boolean) => void;
	setChatShellCollapsed: (collapsed: boolean) => void;
	setChatShellWidth: (width: number) => void;
	setRightPanelCollapsed: (collapsed: boolean) => void;
	setMobileChatListOpen: (open: boolean) => void;
}

export const useShellLayoutStore = create<ShellLayoutState>((set) => ({
	chatRailCollapsed: true,
	chatShellCollapsed: false,
	chatShellWidth: SHELL_CHAT_WIDTH_DEFAULT,
	rightPanelCollapsed: true,
	mobileChatListOpen: false,
	setChatRailCollapsed: (chatRailCollapsed) => set({ chatRailCollapsed }),
	setChatShellCollapsed: (chatShellCollapsed) => set({ chatShellCollapsed }),
	setChatShellWidth: (chatShellWidth) => set({ chatShellWidth }),
	setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
	setMobileChatListOpen: (mobileChatListOpen) => set({ mobileChatListOpen }),
}));
