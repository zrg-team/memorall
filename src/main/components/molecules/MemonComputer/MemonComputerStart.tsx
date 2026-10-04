import { Loader2, Power } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
	MEMON_APP_ICONS,
	MEMON_APP_TINTS,
	MemonLogo,
} from "./MemonWindowFrame";
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
		<div className="flex h-full items-center justify-center bg-muted/30 bg-[image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] p-4 [background-size:22px_22px]">
			<div className="flex w-full max-w-md flex-col items-center gap-5 rounded-lg border bg-background p-7 text-center shadow-[0_8px_24px_-10px_rgb(0_0_0/0.35)]">
				<MemonLogo size={64} />
				<div className="space-y-1.5">
					<p className="text-lg font-semibold tracking-tight">
						{t("memonComputer.start.title")}
					</p>
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						{t("memonComputer.start.description")}
					</p>
				</div>
				{loading ? (
					<Loader2 size={18} className="animate-spin text-muted-foreground" />
				) : agent ? (
					<div className="flex w-full max-w-xs flex-col gap-3">
						<Select value={agent.id} onValueChange={setPickedId}>
							<SelectTrigger
								className="h-10 rounded-md"
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
								...MEMON_BUILTIN_APPS.filter(
									(app) => app !== "pi" || agent.config.piCode,
								),
							].map((app) => {
								const Icon = MEMON_APP_ICONS[app];
								return (
									<span
										key={app}
										className={cn(
											"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
											MEMON_APP_TINTS[app],
										)}
									>
										<Icon size={12} />
										{t(`memonComputer.apps.${app}`)}
									</span>
								);
							})}
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-10 rounded-md border-transparent bg-blue-600 font-semibold text-white hover:bg-blue-500 hover:text-white"
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
