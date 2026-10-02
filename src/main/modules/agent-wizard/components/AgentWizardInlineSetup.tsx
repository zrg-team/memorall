import React from "react";
import type { useAgentWizard } from "../hooks/use-agent-wizard";
import { AgentWizardComputerOffer } from "./AgentWizardComputerOffer";

/**
 * Loaded on demand: this pulls the MCP discovery client and the Composio client,
 * which the wizard has no reason to carry unless setup is actually opened.
 */
const AgentWizardConnectionSetup = React.lazy(() =>
	import("./AgentWizardConnectionSetup").then((module) => ({
		default: module.AgentWizardConnectionSetup,
	})),
);

/** Whether the wizard has a card or panel open for the user. */
export const hasAgentWizardInlineSetup = (
	wizard: ReturnType<typeof useAgentWizard>,
): boolean => Boolean(wizard.computerOffer || wizard.connectionSetup);

/**
 * What the wizard opens between the transcript and the composer, the same in
 * every place the wizard is shown: the MemonOS Bot card and connection setup.
 */
export const AgentWizardInlineSetup = ({
	wizard,
}: {
	wizard: ReturnType<typeof useAgentWizard>;
}): React.ReactNode => {
	if (!hasAgentWizardInlineSetup(wizard)) return null;
	return (
		<>
			{wizard.computerOffer ? (
				<AgentWizardComputerOffer
					offer={wizard.computerOffer}
					onAccept={wizard.acceptComputerOffer}
					onDismiss={wizard.dismissComputerOffer}
				/>
			) : null}
			{wizard.connectionSetup ? (
				<React.Suspense fallback={null}>
					<AgentWizardConnectionSetup
						request={wizard.connectionSetup}
						onClose={wizard.closeConnectionSetup}
						onConnected={wizard.attachConnection}
					/>
				</React.Suspense>
			) : null}
		</>
	);
};
