import { Loader2, Monitor, Power } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/main/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { useChatStore } from "@/main/stores/chat";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import { MEMON_APP_IDS, MEMON_BUILTIN_APPS } from "@/services/memon/constants";
import { MEMON_APP_ICONS } from "./MemonWindowFrame";
import type { MemonAgent } from "./use-memon-agents";

/**
 * Shown on Runtime → Computer before the chat has a computer: the user picks
 * an agent with MemonOS Bot and starts its computer to use it themselves. The
 * computer belongs to the agent, so it continues on it in any chat.
 */
export const MemonComputerStart: React.FC<{
	agents: MemonAgent[];
	loading: boolean;
}> = ({ agents, loading }) => {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const chatAgentId = useChatStore((state) => state.selectedAgentFlowId);
	const setSelectedAgentFlowId = useChatStore(
		(state) => state.setSelectedAgentFlowId,
	);
	const send = useMemonMachineStore((state) => state.send);
	const error = useMemonMachineStore((state) => state.error);
	const [pickedId, setPickedId] = React.useState<string | null>(null);
	const [starting, setStarting] = React.useState(false);

	const agent =
		agents.find((candidate) => candidate.id === pickedId) ??
		agents.find((candidate) => candidate.id === chatAgentId) ??
		agents[0];

	const start = async () => {
		if (!agent) return;
		setStarting(true);
		try {
			// The computer is the agent's: chatting with it continues here.
			setSelectedAgentFlowId(agent.id);
			await send("machine.start", {
				key: agent.id,
				config: agent.config,
				agentId: agent.id,
			});
		} finally {
			setStarting(false);
		}
	};

	return (
		<div className="flex h-full items-center justify-center p-4">
			<div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 p-6 text-center">
				<Monitor size={20} className="text-muted-foreground" />
				<div className="max-w-sm space-y-1">
					<p className="text-sm font-medium">
						{t("memonComputer.start.title")}
					</p>
					<p className="text-xs text-muted-foreground">
						{t("memonComputer.start.description")}
					</p>
				</div>
				{loading ? (
					<Loader2 size={16} className="animate-spin text-muted-foreground" />
				) : agent ? (
					<div className="flex w-full max-w-xs flex-col gap-2">
						<Select value={agent.id} onValueChange={setPickedId}>
							<SelectTrigger
								className="h-9"
								aria-label={t("memonComputer.start.agent")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{agents.map((candidate) => (
									<SelectItem key={candidate.id} value={candidate.id}>
										{candidate.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<div className="flex flex-wrap justify-center gap-1.5">
							{[
								...MEMON_APP_IDS.filter((app) => agent.config.apps[app]),
								...MEMON_BUILTIN_APPS,
							].map((app) => {
								const Icon = MEMON_APP_ICONS[app];
								return (
									<span
										key={app}
										className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
									>
										<Icon size={11} />
										{t(`memonComputer.apps.${app}`)}
									</span>
								);
							})}
						</div>
						<Button
							type="button"
							size="sm"
							disabled={starting}
							onClick={() => void start()}
						>
							{starting ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<Power size={14} />
							)}
							{t("memonComputer.start.button")}
						</Button>
						{error ? (
							<p className="text-xs text-red-700 dark:text-red-300">{error}</p>
						) : null}
					</div>
				) : (
					<div className="flex max-w-sm flex-col items-center gap-2">
						<p className="text-xs text-muted-foreground">
							{t("memonComputer.start.noAgents")}
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => navigate("/agents")}
						>
							{t("memonComputer.start.openAgents")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
};
