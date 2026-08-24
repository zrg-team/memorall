import React from "react";
import { useTranslation } from "react-i18next";
import {
	GRAPH_REGISTRY,
	useAgentConfigStore,
} from "@/main/stores/agent-config";
import { Separator } from "@/main/components/ui/separator";
import { cn } from "@/lib/utils";
import { CursorPoint, hideAgentCursor } from "@/components/AgentCursor";
import {
	AGENT_WIZARD_CURSOR_KEYS,
	clearQueuedAgentWizardCursorMoves,
} from "@/main/modules/agent-wizard";
import { FeaturesGrid } from "./FeaturesGrid";
import { SystemPromptEditor } from "./SystemPromptEditor";
import {
	AdvancedGraphSection,
	AgentIdentitySection,
	AgentIntegrationsSection,
	LegacyConfigWarning,
	type AgentConfigFormProps,
} from "./agent-config-form";

export type {
	AgentConfigFormActions,
	AgentCronJobFormState,
} from "./agent-config-form";

export const AgentConfigForm: React.FC<AgentConfigFormProps> = ({
	className,
	metadataDraft,
	configSummary,
	memoryTopic,
	onMetadataChange,
	formActions,
	cronJobs,
}) => {
	const { t } = useTranslation(["chat", "agents", "common"]);
	const {
		currentGraphType,
		draftConfig,
		isLegacyConfig,
		isLoading,
		isSaving,
		setGraphType,
		updateField,
		convertToUnified,
	} = useAgentConfigStore();

	const [showBaseGraph, setShowBaseGraph] = React.useState(false);

	React.useEffect(() => {
		return () => {
			clearQueuedAgentWizardCursorMoves();
			hideAgentCursor();
		};
	}, []);

	const currentGraphMeta = GRAPH_REGISTRY.find(
		(graph) => graph.id === currentGraphType,
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center px-6 py-12">
				<div className="text-sm text-muted-foreground">
					{t("agentSettings.loading")}
				</div>
			</div>
		);
	}

	return (
		<div className={cn("space-y-6 max-w-3xl mx-auto", className)}>
			{metadataDraft && onMetadataChange ? (
				<AgentIdentitySection
					metadataDraft={metadataDraft}
					configSummary={configSummary}
					memoryTopic={memoryTopic}
					onMetadataChange={onMetadataChange}
					formActions={formActions}
				/>
			) : null}

			{isLegacyConfig ? (
				<LegacyConfigWarning
					isSaving={isSaving}
					onConvertToUnified={() => void convertToUnified()}
				/>
			) : null}

			<AgentIntegrationsSection
				metadataDraft={metadataDraft}
				cronJobs={cronJobs}
			/>

			<Separator />

			<CursorPoint
				cursorKey={[
					AGENT_WIZARD_CURSOR_KEYS.features,
					AGENT_WIZARD_CURSOR_KEYS.tools,
					AGENT_WIZARD_CURSOR_KEYS.multiAgent,
				]}
			>
				<FeaturesGrid summary={configSummary} />
			</CursorPoint>

			<Separator />

			<CursorPoint cursorKey={AGENT_WIZARD_CURSOR_KEYS.systemPrompt}>
				<SystemPromptEditor />
			</CursorPoint>

			<Separator />

			<AdvancedGraphSection
				currentGraphType={currentGraphType}
				currentGraphMeta={currentGraphMeta}
				maxIterations={draftConfig.maxIterations}
				showBaseGraph={showBaseGraph}
				setShowBaseGraph={setShowBaseGraph}
				setGraphType={setGraphType}
				setMaxIterations={(value) => updateField("maxIterations", value)}
			/>
		</div>
	);
};
