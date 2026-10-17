import React from "react";
import { serviceManager } from "@/services";
import { coerceDate } from "../types";
import { agentTeamOf } from "../utils/agent-teams";

const NO_TEAMS: ReadonlyMap<string, string[]> = new Map();

/**
 * Each agent's team (see agentTeamOf), for agents that have one. Read again
 * for an agent whenever its `updatedAt` changes: saving its config moves it.
 */
export const useAgentTeams = (
	agents: ReadonlyArray<{
		id: string;
		updatedAt?: Date | string | null;
	}>,
): ReadonlyMap<string, string[]> => {
	const [teams, setTeams] = React.useState(NO_TEAMS);
	const key = agents
		.map(
			(agent) => `${agent.id}@${coerceDate(agent.updatedAt)?.getTime() ?? ""}`,
		)
		.join("|");

	React.useEffect(() => {
		const ids = key ? key.split("|").map((entry) => entry.split("@")[0]) : [];
		if (!ids.length) {
			setTeams(NO_TEAMS);
			return;
		}
		let cancelled = false;
		void Promise.all(
			ids.map(async (id) => {
				try {
					const config =
						await serviceManager.flowBuilderService.getUnifiedFlowConfig({
							flowId: id,
						});
					return [id, agentTeamOf(config)] as const;
				} catch {
					return [id, [] as string[]] as const;
				}
			}),
		).then((entries) => {
			if (cancelled) return;
			setTeams(new Map(entries.filter(([, team]) => team.length > 0)));
		});
		return () => {
			cancelled = true;
		};
	}, [key]);

	return teams;
};
