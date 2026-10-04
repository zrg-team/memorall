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
	/**
	 * The right panel's page fills it: the panel's tab bar and the page header
	 * hide, chat stays beside it. The page that set it clears it on leaving.
	 */
	rightPanelMaximized: boolean;
	mobileChatListOpen: boolean;
	setChatRailCollapsed: (collapsed: boolean) => void;
	setChatShellCollapsed: (collapsed: boolean) => void;
	setChatShellWidth: (width: number) => void;
	setRightPanelCollapsed: (collapsed: boolean) => void;
	setRightPanelMaximized: (maximized: boolean) => void;
	setMobileChatListOpen: (open: boolean) => void;
}

export const useShellLayoutStore = create<ShellLayoutState>((set) => ({
	chatRailCollapsed: true,
	chatShellCollapsed: false,
	chatShellWidth: SHELL_CHAT_WIDTH_DEFAULT,
	rightPanelCollapsed: true,
	rightPanelMaximized: false,
	mobileChatListOpen: false,
	setChatRailCollapsed: (chatRailCollapsed) => set({ chatRailCollapsed }),
	setChatShellCollapsed: (chatShellCollapsed) => set({ chatShellCollapsed }),
	setChatShellWidth: (chatShellWidth) => set({ chatShellWidth }),
	setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
	setRightPanelMaximized: (rightPanelMaximized) => set({ rightPanelMaximized }),
	setMobileChatListOpen: (mobileChatListOpen) => set({ mobileChatListOpen }),
}));
