import React from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslation } from "react-i18next";
import { Search, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { TOOL_DISPLAY_INFO } from "@/main/modules/chat/utils/tool-display-info";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Switch } from "@/main/components/ui/switch";
import { Textarea } from "@/main/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import type { FeatureDetailViewSlot } from "@/services/flows/flow-builder-catalog";
import { DEFAULT_CONTEXT_SYSTEM_PROMPT } from "@/services/flows/steps/common/context-to-system";
import {
	getAgentFeatureDescription,
	getAgentFeatureDisplayName,
} from "../utils/feature-display";
import { KNOWLEDGE_RETRIEVAL_MODES } from "@/main/stores/agent-config";
import { VisualizeResponseFeatureConfig } from "../components/VisualizeResponseFeatureConfig";

interface AgentFeatureDetailModalProps {
	featureName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mergeToolSelection = (
	currentTools: string[],
	visibleTools: string[],
	availableTools: string[],
	mode: "enable" | "disable",
) => {
	const nextSelection = new Set(currentTools);
	for (const toolName of visibleTools) {
		if (mode === "enable") nextSelection.add(toolName);
		else nextSelection.delete(toolName);
	}
	return availableTools.filter((toolName) => nextSelection.has(toolName));
};

const prettifyToolName = (toolName: string) =>
	toolName
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

const getToolFallbackDescription = (toolName: string) => {
	if (toolName.startsWith("container_")) return "Run or inspect sandbox container operations.";
	if (toolName.startsWith("web_")) return "Open, read, inspect, or interact with browser pages.";
	if (toolName.startsWith("fs_")) return "Read, search, edit, or manage workspace files.";
	if (toolName.startsWith("doc_")) return "Read, search, edit, or manage document files.";
	if (toolName.startsWith("memory_")) return "Manage durable memory in the selected topic graph.";
	if (toolName.startsWith("co_agent_")) return "Observe or interact with the current page through Co-agent.";
	return "Tool available to this agent during response generation.";
};

// ---------------------------------------------------------------------------
// Slot renderers
// ---------------------------------------------------------------------------

const ToolPickerSlot: React.FC<{
	slot: Extract<FeatureDetailViewSlot, { component: "ToolPicker" }>;
	claimedToolSet: Set<string>;
}> = ({ slot, claimedToolSet }) => {
	const { t } = useTranslation("chat");
	const { draftConfig, draftFeatures, featureDefinitions, availableTools, updateField, toggleTool } =
		useAgentConfigStore();
	const [toolSearch, setToolSearch] = React.useState("");

	const toolsToShow =
		slot.scope === "all"
			? availableTools
			: availableTools.filter((tool) => !claimedToolSet.has(tool));

	// Tools that are enabled transitively by active features (not by this ToolPicker)
	const featureEnabledTools = React.useMemo(() => {
		const set = new Set<string>();
		for (const feature of featureDefinitions) {
			if (feature.detailView?.some((s) => s.component === "ToolPicker")) continue;
			if (!draftFeatures[feature.name]) continue;
			for (const tool of feature.tools) set.add(tool);
		}
		return set;
	}, [featureDefinitions, draftFeatures]);

	const isEnabled = (toolName: string) =>
		draftConfig.tools.includes(toolName) || featureEnabledTools.has(toolName);

	const normalizedSearch = toolSearch.trim().toLowerCase();
	const visibleTools = (
		normalizedSearch
			? toolsToShow.filter((toolName) => {
					const info = TOOL_DISPLAY_INFO[toolName];
					const label = info?.name ?? prettifyToolName(toolName);
					const description = info?.description ?? "";
					return [toolName, label, description]
						.join(" ")
						.toLowerCase()
						.includes(normalizedSearch);
				})
			: toolsToShow
	)
		.slice()
		.sort((a, b) => Number(isEnabled(b)) - Number(isEnabled(a)));

	const enabledCount = toolsToShow.filter(isEnabled).length;

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<p className="text-xs font-semibold text-foreground/80">
						{t("agentSettings.featureTools")}
					</p>
					<Badge
						variant="secondary"
						className="rounded-full px-1.5 py-0 text-[10px] font-normal"
					>
						{enabledCount}/{toolsToShow.length}
					</Badge>
				</div>
				<div className="flex gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
						onClick={() =>
							updateField(
								"tools",
								mergeToolSelection(draftConfig.tools, visibleTools, availableTools, "enable"),
							)
						}
					>
						{t("agentSettings.enableAll")}
					</Button>
					<span className="my-auto text-[10px] text-border">·</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
						onClick={() =>
							updateField(
								"tools",
								mergeToolSelection(draftConfig.tools, visibleTools, availableTools, "disable"),
							)
						}
					>
						{t("agentSettings.disableAll")}
					</Button>
				</div>
			</div>
			<div className="relative">
				<Search
					size={13}
					className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					value={toolSearch}
					onChange={(event) => setToolSearch(event.target.value)}
					placeholder="Filter tools by name or description"
					className="h-8 rounded-lg pl-8 text-xs"
				/>
			</div>
			<div className="grid grid-cols-1 gap-1.5 min-[520px]:grid-cols-2">
				{visibleTools.map((toolName) => {
					const info = TOOL_DISPLAY_INFO[toolName];
					const enabled = isEnabled(toolName);
					const locked = featureEnabledTools.has(toolName);
					const toolLabel = info?.name ?? prettifyToolName(toolName);
					const toolDescription = info?.descriptionKey
						? t(info.descriptionKey, {
								ns: "chat",
								defaultValue: info.description,
							})
						: (info?.description ?? getToolFallbackDescription(toolName));
					return (
						<div
							key={toolName}
							onClick={() => !locked && toggleTool(toolName)}
							className={cn(
								"group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
								locked
									? "cursor-default border-border/40 bg-muted/20"
									: "cursor-pointer",
								!locked && (enabled
									? "border-primary/25 bg-primary/5 hover:bg-primary/8"
									: "border-border/50 bg-background/50 hover:bg-muted/40"),
							)}
						>
							<div className="min-w-0 flex-1">
								<p
									className={cn(
										"truncate text-[11px] font-semibold leading-tight",
										enabled ? "text-foreground" : "text-foreground/70",
									)}
								>
									{toolLabel}
									{locked && (
										<span className="ml-1.5 text-[9px] font-normal text-muted-foreground/60">
											via feature
										</span>
									)}
								</p>
								<p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-muted-foreground/80">
									{toolName}
								</p>
								<p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
									{toolDescription}
								</p>
							</div>
							<Switch
								checked={enabled}
								onCheckedChange={() => !locked && toggleTool(toolName)}
								onClick={(e) => e.stopPropagation()}
								disabled={locked}
								className={cn("shrink-0 scale-[0.8]", locked ? "opacity-50" : "pointer-events-none")}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
};

const RetrievalModeSelectSlot: React.FC = () => {
	const { draftConfig, setKnowledgeRetrievalMode } = useAgentConfigStore();
	return (
		<div className="space-y-2">
			<Label className="text-xs font-medium">Knowledge Retrieval Mode</Label>
			<Select
				value={draftConfig.retrievalMode}
				onValueChange={(value) =>
					setKnowledgeRetrievalMode(value as typeof draftConfig.retrievalMode)
				}
			>
				<SelectTrigger className="h-9">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{KNOWLEDGE_RETRIEVAL_MODES.map((mode) => (
						<SelectItem key={mode.mode} value={mode.mode}>
							{mode.mode === "smart"
								? "Smart"
								: mode.mode === "quick"
									? "Quick"
									: mode.mode === "llm"
										? "LLM"
										: "StructMem"}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-[10px] text-muted-foreground">
				Choose the retrieval implementation used before response generation.
				StructMem searches event memories plus consolidated syntheses.
			</p>
		</div>
	);
};

const PromptInputSlot: React.FC<{
	slot: Extract<FeatureDetailViewSlot, { component: "PromptInput" }>;
}> = ({ slot }) => {
	const { t } = useTranslation("chat");
	const { draftConfig, updateField } = useAgentConfigStore();
	const value = draftConfig[slot.configName] || slot.defaultValue;
	return (
		<div className="space-y-2">
			<Label className="text-xs font-medium">{t(slot.labelKey)}</Label>
			<Textarea
				value={value}
				onChange={(event) =>
					updateField(
						slot.configName,
						event.target.value === slot.defaultValue ? "" : event.target.value,
					)
				}
				className="min-h-[220px] resize-y rounded-xl border-border/70 bg-background/80 font-mono text-xs"
			/>
			<p className="text-[10px] text-muted-foreground">{t(slot.hintKey)}</p>
		</div>
	);
};

const AgentPickerSlot: React.FC = () => {
	const { t } = useTranslation("chat");
	const {
		availableAgents,
		currentFlowId,
		draftMultiAgentAccessibleAgentIds,
		setAccessibleAgents,
		toggleAccessibleAgent,
	} = useAgentConfigStore();

	const selectableAgents = availableAgents.filter(
		(agent) => agent.id !== currentFlowId,
	);
	const selectedCount = draftMultiAgentAccessibleAgentIds.filter((id) =>
		selectableAgents.some((agent) => agent.id === id),
	).length;

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<p className="text-sm font-semibold">
					{t("agentSettings.featureAccessibleAgents")}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("agentSettings.agentSelectionHint")}
				</p>
			</div>
			<div className="flex items-center justify-between gap-2">
				<Badge
					variant="secondary"
					className="rounded-full px-1.5 py-0 text-[10px] font-normal"
				>
					{selectedCount}/{selectableAgents.length}
				</Badge>
				<div className="flex gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
						onClick={() =>
							setAccessibleAgents(selectableAgents.map((agent) => agent.id))
						}
					>
						{t("agentSettings.enableAll")}
					</Button>
					<span className="my-auto text-[10px] text-border">·</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
						onClick={() => setAccessibleAgents([])}
					>
						{t("agentSettings.disableAll")}
					</Button>
				</div>
			</div>
			{selectableAgents.length === 0 ? (
				<div className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
					{t("agentSettings.noAccessibleAgents")}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-1.5">
					{selectableAgents.map((agent) => {
						const isEnabled = draftMultiAgentAccessibleAgentIds.includes(agent.id);
						return (
							<div
								key={agent.id}
								onClick={() => toggleAccessibleAgent(agent.id)}
								className={cn(
									"group flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
									isEnabled
										? "border-primary/25 bg-primary/5 hover:bg-primary/8"
										: "border-border/50 bg-background/50 hover:bg-muted/40",
								)}
							>
								<div className="min-w-0 flex-1">
									<p
										className={cn(
											"truncate text-[11px] font-medium leading-tight",
											isEnabled ? "text-foreground" : "text-foreground/70",
										)}
									>
										{agent.name}
									</p>
									<p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
										{agent.description?.trim() || agent.id}
									</p>
								</div>
								<Switch
									checked={isEnabled}
									onCheckedChange={() => toggleAccessibleAgent(agent.id)}
									onClick={(event) => event.stopPropagation()}
									className="pointer-events-none shrink-0 scale-[0.8]"
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

const VisualizeResponseConfigSlot: React.FC = () => (
	<VisualizeResponseFeatureConfig />
);

const StandardFeatureDetailView: React.FC<{
	featureName: string;
}> = ({ featureName }) => {
	const { t } = useTranslation("chat");
	const { featureDefinitions } = useAgentConfigStore();
	const feature = featureDefinitions.find((f) => f.name === featureName);
	if (!feature) return null;

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<p className="text-sm font-semibold">{t("agentSettings.featureTools")}</p>
				<div className="flex flex-wrap gap-2">
					{feature.tools.map((tool) => (
						<Badge key={tool} variant="outline" className="font-mono text-[10px]">
							{tool}
						</Badge>
					))}
				</div>
			</div>
			<div className="space-y-2">
				<p className="text-sm font-semibold">
					{t("agentSettings.featureSystemPrompt")}
				</p>
				<Textarea
					value={feature.systemPrompt}
					readOnly
					className="min-h-[220px] resize-y rounded-xl border-border/70 bg-background/80 font-mono text-xs"
				/>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export const AgentFeatureDetailModal =
	NiceModal.create<AgentFeatureDetailModalProps>(({ featureName }) => {
		const modal = useModal();
		const { t } = useTranslation(["chat", "common"]);
		const { featureDefinitions } = useAgentConfigStore();

		const feature = featureDefinitions.find((f) => f.name === featureName);

		const claimedToolSet = React.useMemo(() => {
			const set = new Set<string>();
			for (const def of featureDefinitions) {
				for (const tool of def.tools) set.add(tool);
			}
			return set;
		}, [featureDefinitions]);

		if (!feature) {
			return (
				<Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
					<DialogContent className="sm:max-w-[540px]">
						<DialogHeader>
							<DialogTitle>{t("agentSettings.detail")}</DialogTitle>
							<DialogDescription>Feature detail is not available.</DialogDescription>
						</DialogHeader>
						<DialogFooter className="flex-row justify-end gap-2">
							<Button type="button" variant="outline" size="sm" onClick={() => modal.hide()}>
								{t("agentSettings.cancel")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			);
		}

		const title = getAgentFeatureDisplayName(feature, t);
		const description = getAgentFeatureDescription(feature, t);
		const hasToolPicker = feature.detailView?.some(
			(s) => s.component === "ToolPicker",
		) ?? false;

		const renderDetailView = () => {
			if (!feature.detailView?.length) {
				return <StandardFeatureDetailView featureName={featureName} />;
			}
			return (
				<div className="space-y-4">
					{feature.detailView.map((slot, index) => {
						if (slot.component === "ToolPicker") {
							return (
								<ToolPickerSlot key={index} slot={slot} claimedToolSet={claimedToolSet} />
							);
						}
						if (slot.component === "RetrievalModeSelect") {
							return <RetrievalModeSelectSlot key={index} />;
						}
						if (slot.component === "PromptInput") {
							return <PromptInputSlot key={index} slot={slot} />;
						}
						if (slot.component === "AgentPicker") {
							return <AgentPickerSlot key={index} />;
						}
						if (slot.component === "VisualizeResponseConfig") {
							return <VisualizeResponseConfigSlot key={index} />;
						}
						return null;
					})}
				</div>
			);
		};

		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => !open && modal.hide()}
			>
				<DialogContent className="flex max-h-[min(90dvh,580px)] w-[calc(100vw-1rem)] max-w-[800px] flex-col overflow-hidden gap-0 rounded-2xl border-border/60 p-0 shadow-2xl sm:w-[min(94vw,800px)]">
					<DialogHeader className="border-b px-5 pt-5 pb-4">
						<div className="flex items-start gap-3">
							<span className="mt-0.5 shrink-0 rounded-lg bg-muted p-1.5 text-muted-foreground">
								{hasToolPicker ? <Wrench size={14} /> : <Sparkles size={14} />}
							</span>
							<div className="min-w-0 flex-1 space-y-1">
								<div className="flex flex-wrap items-center gap-1.5">
									<DialogTitle className="text-sm font-semibold leading-none">
										{title}
									</DialogTitle>
									<Badge
										variant="secondary"
										className="rounded-full px-1.5 py-0 text-[10px] font-normal"
									>
										{t("agentSettings.toolCount", { count: feature.tools.length })}
									</Badge>
								</div>
								<DialogDescription className="text-xs text-muted-foreground">
									{description}
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
						<div className="space-y-4 px-5 py-4">{renderDetailView()}</div>
						<DialogFooter className="sticky bottom-0 border-t bg-background/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 min-w-[80px] text-xs"
								onClick={() => modal.hide()}
							>
								{t("agentSettings.cancel")}
							</Button>
						</DialogFooter>
					</div>
				</DialogContent>
			</Dialog>
		);
	});
