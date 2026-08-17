import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { ComposioWizard, CustomEndpointForm } from "@/main/modules/connections";
import type { McpConnection } from "@/services/mcp-connections";
import { useConnectionsStore } from "@/main/stores/connections";
import type { AgentWizardConnectionSetupRequest } from "../hooks/use-agent-wizard";

/**
 * Connection setup rendered inside the wizard conversation.
 *
 * The wizard's messages are not persisted, so sending the user to the
 * Connections page to authorize an app would throw away everything they have
 * built. This mounts the same setup surfaces inline instead. It also keeps the
 * API key out of the chat transcript: the key is typed into a real component,
 * never into a message that would be sent to the model.
 */
interface AgentWizardConnectionSetupProps {
	request: AgentWizardConnectionSetupRequest;
	onClose: () => void;
	/** Attach the finished connection to the draft. */
	onConnected: (connection: McpConnection) => void;
}

export const AgentWizardConnectionSetup: React.FC<
	AgentWizardConnectionSetupProps
> = ({ request, onClose, onConnected }) => {
	const { t } = useTranslation("connections");
	const connections = useConnectionsStore((state) => state.connections);

	// The Composio lane writes its connection to the registry as it goes, so
	// watch for it rather than requiring a callback the wizard cannot provide.
	const seenRef = React.useRef(new Set(connections.map((entry) => entry.id)));
	React.useEffect(() => {
		for (const connection of connections) {
			if (!seenRef.current.has(connection.id) && connection.url) {
				seenRef.current.add(connection.id);
				onConnected(connection);
			}
		}
	}, [connections, onConnected]);

	return (
		<div className="mx-3 mb-2 overflow-hidden rounded-xl border border-blue-500/30 bg-background shadow-lg">
			<div className="flex items-center justify-between gap-2 border-b border-border/60 bg-blue-500/5 px-3 py-2">
				<span className="text-xs font-semibold">
					{request.kind === "composio"
						? t("lanes.composio.action")
						: t("custom.title")}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="h-6 w-6"
					onClick={onClose}
					aria-label={t("composio.cancel")}
				>
					<X size={13} />
				</Button>
			</div>

			<div className="max-h-[420px] overflow-y-auto p-3">
				{request.kind === "composio" ? (
					<ComposioWizard
						initialSearch={request.toolkit}
						onDone={onClose}
						onCancel={onClose}
					/>
				) : (
					<CustomEndpointForm
						onSaved={(connection) => {
							onConnected(connection);
							onClose();
						}}
						onCancel={onClose}
					/>
				)}
			</div>
		</div>
	);
};
