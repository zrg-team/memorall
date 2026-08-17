import NiceModal from "@ebay/nice-modal-react";
import { Plus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import { AppIcon, ConnectionIcon, StatusDot } from "@/main/modules/connections";
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
						{/* The chip's mark is the app's, not the credential's — every
						    Composio chip wearing the same "C" defeated the point of
						    naming providers instead of connections. */}
						{provider.appId ? (
							<AppIcon
								name={provider.label}
								src={provider.logo}
								composioSlug={provider.appId}
								size={16}
								className="rounded"
							/>
						) : (
							<ConnectionIcon
								kind={provider.connectionKind}
								size={16}
								className="rounded"
							/>
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
