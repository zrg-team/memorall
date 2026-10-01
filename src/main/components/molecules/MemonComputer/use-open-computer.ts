import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useShellLayoutStore } from "@/main/stores/shell-layout";

/** Router state that asks RuntimePage to open its Computer tab. */
export const RUNTIME_COMPUTER_SECTION_STATE = { section: "computer" } as const;

/** Opens the right panel on Runtime → Computer. */
export const useOpenMemonComputer = (): (() => void) => {
	const navigate = useNavigate();
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	return useCallback(() => {
		setRightPanelCollapsed(false);
		navigate("/runtime", { state: RUNTIME_COMPUTER_SECTION_STATE });
	}, [navigate, setRightPanelCollapsed]);
};
