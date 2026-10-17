import React from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentIcon, toAgentScreenContent } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Switch } from "@/main/components/ui/switch";
import { getAgentIconScreenFromMetadata } from "@/main/modules/agents/types";
import { sortFavoritesFirst } from "@/main/modules/agents/utils/agent-display";
import { useFavoriteAgentIds } from "@/main/stores/favorite-agents";
import type { Flow } from "@/services/database/types";
import type { AgentWizardTeamOffer as Offer } from "../types";

/**
 * A team for the agent being built: every agent the user has, the ones the
 * wizard proposed switched on. The user changes the choice and adds it with
 * one click; nothing has to be typed back to the wizard.
 */
export const AgentWizardTeamOffer: React.FC<{
	offer: Offer;
	agents: readonly Flow[];
	onAccept: (agentIds: string[]) => void;
	onDismiss: () => void;
}> = ({ offer, agents, onAccept, onDismiss }) => {
	const { t } = useTranslation("agents");
	const tw = (key: string, options?: Record<string, unknown>) =>
		t(`wizard.teamOffer.${key}`, options);
	const favoriteIds = useFavoriteAgentIds();
	const [chosen, setChosen] = React.useState(() => new Set(offer.agentIds));
	// A newer proposal replaces the choice on the card.
	React.useEffect(() => {
		setChosen(new Set(offer.agentIds));
	}, [offer]);

	// The proposed agents first, then the starred ones, then the rest.
	const ordered = React.useMemo(() => {
		const proposed = new Set(offer.agentIds);
		const sorted = sortFavoritesFirst(agents, favoriteIds);
		return [
			...sorted.filter((agent) => proposed.has(agent.id)),
			...sorted.filter((agent) => !proposed.has(agent.id)),
		];
	}, [agents, favoriteIds, offer.agentIds]);

	const toggle = (agentId: string) =>
		setChosen((current) => {
			const next = new Set(current);
			if (next.has(agentId)) next.delete(agentId);
			else next.add(agentId);
			return next;
		});

	return (
		<div className="mx-3 mb-2 rounded-xl border border-violet-500/40 bg-violet-500/5 p-3 shadow-[0_0_0_1px_rgba(139,92,246,0.15)]">
			<div className="flex items-start gap-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
					<Users size={18} />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">{tw("title")}</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{offer.reason || tw("description")}
					</p>
				</div>
			</div>
			<div className="mt-2.5 max-h-56 space-y-1 overflow-y-auto pr-1">
				{ordered.map((agent) => {
					const on = chosen.has(agent.id);
					return (
						<label
							key={agent.id}
							className={cn(
								"flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
								on
									? "border-violet-500/40 bg-violet-500/10"
									: "border-border/50 bg-background/50 hover:bg-muted/40",
							)}
						>
							<AgentIcon
								size={24}
								reactive={false}
								aria-label={agent.name}
								screenContent={toAgentScreenContent(
									getAgentIconScreenFromMetadata(agent.metadata),
									agent.name,
								)}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-xs font-medium">
									{agent.name}
								</span>
								{agent.description?.trim() ? (
									<span className="block truncate text-[11px] text-muted-foreground">
										{agent.description}
									</span>
								) : null}
							</span>
							<Switch
								checked={on}
								onCheckedChange={() => toggle(agent.id)}
								aria-label={agent.name}
								className="shrink-0 scale-[0.8]"
							/>
						</label>
					);
				})}
			</div>
			<div className="mt-2.5 flex items-center justify-end gap-1.5">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-8 text-xs text-muted-foreground"
					onClick={onDismiss}
				>
					{tw("notNow")}
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-8 bg-violet-600 text-xs text-white hover:bg-violet-500"
					disabled={chosen.size === 0}
					onClick={() =>
						onAccept(
							ordered
								.filter((agent) => chosen.has(agent.id))
								.map((agent) => agent.id),
						)
					}
				>
					{tw("add", { count: chosen.size })}
				</Button>
			</div>
		</div>
	);
};
