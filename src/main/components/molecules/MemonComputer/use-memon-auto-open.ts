import React from "react";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import { useOpenMemonComputer } from "./use-open-computer";

/**
 * Opens Runtime → Computer once the agent's computer starts working,
 * when the agent's MemonOS Bot settings ask for it. Once per working stretch, so
 * the user can navigate away without being pulled back on every tool call.
 */
export const useMemonAutoOpen = (
	machineKey: string | null | undefined,
): void => {
	const openComputer = useOpenMemonComputer();
	const start = useMemonMachineStore((state) => state.start);
	// Just the two fields read, not the summary: a new summary arrives several
	// times a second while the agent works, and this runs inside ChatPage.
	const status = useMemonMachineStore((state) =>
		machineKey ? state.summaries[machineKey]?.status : undefined,
	);
	const showComputer = useMemonMachineStore((state) =>
		machineKey ? state.summaries[machineKey]?.showComputer : undefined,
	);
	const openedForRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		start();
	}, [start]);

	React.useEffect(() => {
		if (!machineKey || !status) return;
		if (status !== "working") {
			if (status === "idle") openedForRef.current = null;
			return;
		}
		if (showComputer !== "auto") return;
		if (openedForRef.current === machineKey) return;
		openedForRef.current = machineKey;
		openComputer();
	}, [machineKey, status, showComputer, openComputer]);
};
