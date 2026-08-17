import NiceModal from "@ebay/nice-modal-react";
import { Link2, Plus, Terminal } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import { StatusDot } from "@/main/modules/connections";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useConnectionsStore } from "@/main/stores/connections";
import { selectedProviders } from "@/services/mcp-connections";
import { MCPServersModal } from "../modals/MCPServersModal";

/**
 * The agent's connections, shown by what they are rather than where they live —
 * "Gmail", not "127.0.0.1:8000". Picking happens against the shared registry.
 */
export const MCPServersSection: React.FC = () => {
	const { t } = useTranslation(["agents", "connections"]);
	const draftConnections = useAgentConfigStore(
		(state) => state.draftConnections,
	);
	const connections = useConnectionsStore((state) => state.connections);
	const initialize = useConnectionsStore((state) => state.initialize);
	const statusOf = useConnectionsStore((state) => state.statusOf);

	React.useEffect(() => {
		void initialize();
	}, [initialize]);

	const openModal = () => {
		void NiceModal.show(MCPServersModal);
	};

	// Chips name providers, not credentials: "GitHub" is what the agent can do,
	// "Composio" is only where the key lives.
	const selected = React.useMemo(
		() => selectedProviders(draftConnections, connections),
		[draftConnections, connections],
	);

	return (
		<CursorPoint
			cursorKey={AGENT_WIZARD_CURSOR_KEYS.mcpServers}
			className="flex min-h-[32px] items-center gap-3"
		>
			<span className="w-20 shrink-0 text-sm text-muted-foreground">
				{t("connections:agent.label")}
			</span>
			<div className="flex flex-wrap items-center gap-1.5">
				{selected.map((provider) => (
					<button
						key={provider.key}
						type="button"
						onClick={openModal}
						className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
					>
						<StatusDot status={statusOf(provider.connectionId)} />
						{provider.connectionKind === "composio" ? (
							<span className="grid h-3.5 w-3.5 place-items-center rounded bg-gradient-to-br from-violet-600 to-fuchsia-500 text-[7px] font-bold text-white">
								C
							</span>
						) : provider.connectionKind === "template" ? (
							<Terminal size={10} className="text-muted-foreground" />
						) : (
							<Link2 size={10} className="text-muted-foreground" />
						)}
						<span>{provider.label}</span>
					</button>
				))}
				<button
					type="button"
					onClick={openModal}
					className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					<Plus size={12} />
					{t("connections:agent.manage")}
				</button>
			</div>
		</CursorPoint>
	);
};
