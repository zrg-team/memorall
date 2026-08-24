import React from "react";
import { useTranslation } from "react-i18next";
import {
	GRAPH_REGISTRY,
	useAgentConfigStore,
} from "@/main/stores/agent-config";
import { Separator } from "@/main/components/ui/separator";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { cn } from "@/lib/utils";
import { CursorPoint, hideAgentCursor } from "@/components/AgentCursor";
import {
	MAX_AGENT_MAX_ITERATIONS,
	MIN_AGENT_MAX_ITERATIONS,
	normalizeAgentMaxIterations,
} from "@memorall/agent-harness-flows/limits";
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

			<div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
				<div className="min-w-0 space-y-1">
					<Label
						htmlFor="agent-max-iterations"
						className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
					>
						{t("maxIterations.label", { ns: "agents" })}
					</Label>
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{t("maxIterations.description", { ns: "agents" })}
					</p>
				</div>
				<Input
					id="agent-max-iterations"
					type="number"
					min={MIN_AGENT_MAX_ITERATIONS}
					max={MAX_AGENT_MAX_ITERATIONS}
					step={1}
					value={draftConfig.maxIterations}
					onChange={(event) => {
						const value = event.currentTarget.valueAsNumber;
						if (Number.isFinite(value)) {
							updateField("maxIterations", normalizeAgentMaxIterations(value));
						}
					}}
					className="h-10 w-full shrink-0 rounded-xl border-border/70 bg-background/80 sm:w-32"
				/>
			</div>

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
				showBaseGraph={showBaseGraph}
				setShowBaseGraph={setShowBaseGraph}
				setGraphType={setGraphType}
			/>
		</div>
	);
};
