import type React from "react";
import { AgentIcon, toAgentScreenContent } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import type { FlowMetadata } from "@/services/database/entities/flows";
import { getAgentIconScreenFromMetadata } from "../types";

export interface AgentTeamMember {
	id: string;
	name: string;
	metadata?: FlowMetadata | null;
}

/** How much of each face the next one covers. */
const OVERLAP = 0.45;

/**
 * The team's faces in a stack, the first on top, then "+n" for the rest
 * unless `showRest` is off.
 */
export const AgentTeamAvatars: React.FC<{
	agents: readonly AgentTeamMember[];
	max?: number;
	size?: number;
	showRest?: boolean;
	className?: string;
}> = ({ agents, max = 4, size = 20, showRest = true, className }) => {
	const shown = agents.slice(0, max);
	const rest = agents.length - shown.length;
	const offset = -Math.round(size * OVERLAP);
	return (
		<span className={cn("flex shrink-0 items-center", className)}>
			{shown.map((agent, index) => (
				<span
					key={agent.id}
					title={agent.name}
					className="relative flex"
					style={{
						zIndex: shown.length - index,
						marginLeft: index === 0 ? 0 : offset,
					}}
				>
					<AgentIcon
						size={size}
						reactive={false}
						aria-label={agent.name}
						screenContent={toAgentScreenContent(
							getAgentIconScreenFromMetadata(agent.metadata),
							agent.name,
						)}
					/>
				</span>
			))}
			{showRest && rest > 0 ? (
				<span
					className="relative flex items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground ring-2 ring-background"
					style={{ height: size, minWidth: size, marginLeft: offset / 2 }}
				>
					+{rest}
				</span>
			) : null}
		</span>
	);
};
