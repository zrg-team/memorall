import React from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/main/stores/chat";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import { useActiveProcessCount } from "@/main/stores/process-monitor";

/**
 * A slim, persistent bar that sits at the top of the right panel across every
 * harness tab. It frames the whole panel as "this agent's harness" by showing
 * the active agent's identity on the left and a live "Following" status on the
 * right (idle / working / N running) — the real-time observability signal that
 * makes an agent workspace feel alive (cf. Devin's "Following", Manus's computer).
 */
export const HarnessStatusBar: React.FC = () => {
	const { t } = useTranslation("common");
	const isLoading = useChatStore((state) => state.isLoading);
	const selectedAgentFlowId = useChatStore(
		(state) => state.selectedAgentFlowId,
	);
	const availableAgents = useAgentConfigStore((state) => state.availableAgents);
	const commandsCount = useRuntimeSessionsStore(
		(state) => state.commands.length,
	);
	const serversCount = useRuntimeSessionsStore((state) => state.servers.length);
	const hasActiveWebSession = useRuntimeSessionsStore(
		(state) => state.activeWebSession.isOpen,
	);
	const activeProcessCount = useActiveProcessCount();
	const runtimeCount =
		commandsCount + serversCount + Number(hasActiveWebSession);
	const activeWorkCount = runtimeCount + activeProcessCount;
	const wasActiveRef = React.useRef(false);
	const [recentlyDone, setRecentlyDone] = React.useState(false);

	React.useEffect(() => {
		const isActive = isLoading || activeWorkCount > 0;
		if (!isActive && wasActiveRef.current) {
			setRecentlyDone(true);
			const timeout = window.setTimeout(() => setRecentlyDone(false), 4000);
			wasActiveRef.current = false;
			return () => window.clearTimeout(timeout);
		}
		if (isActive) {
			wasActiveRef.current = true;
			setRecentlyDone(false);
		}
		return undefined;
	}, [activeWorkCount, isLoading]);

	const agentName =
		availableAgents.find((a) => a.id === selectedAgentFlowId)?.name ??
		t("harness.defaultAgentName", { defaultValue: "Agent" });

	const status: "working" | "running" | "processing" | "done" | "idle" =
		isLoading
			? "working"
			: runtimeCount > 0
				? "running"
				: activeProcessCount > 0
					? "processing"
					: recentlyDone
						? "done"
						: "idle";

	const statusLabel =
		status === "working"
			? t("harness.status.working", { defaultValue: "Working…" })
			: status === "running"
				? t("harness.status.running", {
						count: runtimeCount,
						defaultValue: "{{count}} running",
					})
				: status === "processing"
					? t("harness.status.processing", {
							count: activeProcessCount,
							defaultValue: "{{count}} processing",
						})
					: status === "done"
						? t("harness.status.done", { defaultValue: "Done" })
						: t("harness.status.idle", { defaultValue: "Idle" });

	const dotClass =
		status === "working"
			? "bg-blue-500 animate-pulse"
			: status === "running"
				? "bg-emerald-500"
				: status === "processing"
					? "bg-amber-500 animate-pulse"
					: status === "done"
						? "bg-emerald-400"
						: "bg-muted-foreground/40";

	return (
		<div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-app/60 px-3">
			<div className="flex min-w-0 items-center gap-2">
				<span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
					<Bot size={13} />
				</span>
				<span className="truncate text-xs font-medium text-foreground">
					{agentName}
				</span>
				<span className="hidden text-[11px] text-muted-foreground/70 sm:inline">
					{t("harness.label", { defaultValue: "harness" })}
				</span>
			</div>
			<div className="flex flex-shrink-0 items-center gap-1.5">
				<span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
				<span className="text-[11px] font-medium text-muted-foreground">
					{statusLabel}
				</span>
			</div>
		</div>
	);
};
