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
	const summary = useMemonMachineStore((state) =>
		machineKey ? state.summaries[machineKey] : undefined,
	);
	const openedForRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		start();
	}, [start]);

	React.useEffect(() => {
		if (!summary) return;
		if (summary.status !== "working") {
			if (summary.status === "idle") openedForRef.current = null;
			return;
		}
		if (summary.showComputer !== "auto") return;
		if (openedForRef.current === summary.key) return;
		openedForRef.current = summary.key;
		openComputer();
	}, [summary, openComputer]);
};
