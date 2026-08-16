import React from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import type { Flow } from "@/services/database/types";
import type { AgentWizardDraft } from "../types";
import { useAgentWizard } from "../hooks/use-agent-wizard";
import { AgentWizardChatPanel } from "./AgentWizardChatPanel";

/**
 * Loaded on demand: this pulls the MCP discovery client and the Composio client,
 * which the wizard has no reason to carry unless setup is actually opened.
 */
const AgentWizardConnectionSetup = React.lazy(() =>
	import("./AgentWizardConnectionSetup").then((module) => ({
		default: module.AgentWizardConnectionSetup,
	})),
);
import { AgentWizardTemplatePanel } from "./AgentWizardTemplatePanel";

interface AgentWizardWorkspaceProps {
	createPreset: (
		name: string,
		options: Pick<AgentWizardDraft, "growType" | "recallType" | "status">,
	) => Promise<Flow | null>;
	onCreated: (flowId: string) => Promise<void> | void;
	onExit: () => void;
}

export const AgentWizardWorkspace: React.FC<AgentWizardWorkspaceProps> = ({
	createPreset,
	onCreated,
	onExit,
}) => {
	const { t } = useTranslation(["agents"]);
	const wizard = useAgentWizard({
		open: true,
		createPreset,
		onCreated,
		onClose: onExit,
	});

	return (
		<div className="grid h-full min-h-0 grid-cols-[minmax(320px,0.78fr)_minmax(520px,1.22fr)] bg-background">
			<div className="relative h-full min-h-0 overflow-hidden">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="absolute left-3 top-3 z-20 h-8 gap-1.5 bg-background/80 text-xs backdrop-blur"
					onClick={wizard.requestClose}
				>
					<ArrowLeft size={13} />
				</Button>
				<AgentWizardChatPanel
					messages={wizard.messages}
					inputValue={wizard.inputValue}
					onInputChange={wizard.setInputValue}
					onSubmit={wizard.submitMessage}
					onStop={wizard.stop}
					isStreaming={wizard.isStreaming}
					isModelReady={wizard.isModelReady}
					setupSlot={
						wizard.connectionSetup ? (
							<React.Suspense fallback={null}>
								<AgentWizardConnectionSetup
									request={wizard.connectionSetup}
									onClose={wizard.closeConnectionSetup}
									onConnected={wizard.attachConnection}
								/>
							</React.Suspense>
						) : null
					}
				/>
			</div>
			<AgentWizardTemplatePanel
				templates={wizard.templates}
				selectedTemplateId={wizard.draft.templateId}
				onSelectTemplate={wizard.applyTemplate}
				error={wizard.error}
			/>
		</div>
	);
};
