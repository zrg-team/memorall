import { useCallback } from "react";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import type { MemonFeatureConfig } from "@/services/memon/feature-config";
import { logError } from "@/utils/logger";
import { useOpenMemonComputer } from "./use-open-computer";

/**
 * The chat composer's Computer button. One click opens Runtime → Computer and,
 * when the agent has no computer running, starts it. A computer belongs to
 * its agent, so every chat with the agent shares it. `open` is undefined for
 * agents without MemonOS Bot, so the button stays hidden.
 */
export const useAgentComputer = (
	agentId: string | null,
	config: MemonFeatureConfig | null,
): { open: (() => void) | undefined; working: boolean } => {
	const openComputer = useOpenMemonComputer();
	const send = useMemonMachineStore((state) => state.send);
	const working = useMemonMachineStore((state) =>
		agentId ? state.summaries[agentId]?.status === "working" : false,
	);

	const open = useCallback(() => {
		openComputer();
		if (!agentId || !config) return;
		const machines = useMemonMachineStore.getState();
		if (machines.summaries[agentId] || machines.snapshots[agentId]) return;
		void send("machine.start", { key: agentId, config, agentId }).catch(
			(error) => logError("[MEMON] Failed to start the computer:", error),
		);
	}, [agentId, config, openComputer, send]);

	return { open: config ? open : undefined, working };
};
