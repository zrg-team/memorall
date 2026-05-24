import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
	useAgentWizard,
	type AgentWizardDraft,
} from "@/main/modules/agent-wizard";
import { serviceManager } from "@/services";
import { topicService } from "@/main/modules/topics/services/topic-service";
import { logError } from "@/utils/logger";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useChatStore } from "@/main/stores/chat";
import {
	DEFAULT_GROW_TYPE,
	DEFAULT_RECALL_TYPE,
} from "@/services/database/entities/topic-types";
import type { AgentConfigFormActions } from "../components/AgentConfigForm";
import type {
	CreateAgentOptions,
	CreateAgentTopicOptions,
} from "../components/AgentMemoryTypeControls";
import { metadataWithAgentIconScreen } from "../types";
import { useAgentPresets } from "./use-agent-presets";
import { useAgentMemoryTopic } from "./use-agent-memory-topic";
import { useAgentConfigSummary } from "./use-agent-config-summary";
import { useAgentsWorkspacePanels } from "./use-agents-workspace-panels";
import { useUnsavedAgentWorkspaceGuard } from "./use-unsaved-agent-workspace-guard";
import { useAgentCronJobs } from "./use-agent-cron-jobs";

export const useAgentsWorkspaceController = () => {
	const { t } = useTranslation(["agents", "chat", "common"]);
	const location = useLocation();
	const navigate = useNavigate();
	const {
		presets,
		filteredPresets,
		selectedPreset,
		selectedPresetId,
		searchQuery,
		metadataDraft,
		hasMetadataChanges,
		isLoading: isPresetListLoading,
		isCreating,
		isDeleting,
		isSavingMetadata,
		error,
		canDeleteSelectedPreset,
		setSearchQuery,
		selectPreset,
		updateMetadataField,
		refreshPresets,
		createPreset,
		revertMetadata,
		deleteSelectedPreset,
	} = useAgentPresets();
	const {
		draftConfig,
		draftFeatures,
		draftMultiAgentAccessibleAgentIds,
		draftMCPServers,
		draftEnabledSkillNames,
		featureDefinitions,
		availableTools,
		currentGraphType,
		initialize,
		isLegacyConfig,
		isDirty: hasConfigChanges,
		isLoading: isConfigLoading,
		isSaving: isConfigSaving,
		setGraphType,
		setEnabledSkills,
		setMCPServers,
		setAccessibleAgents,
		toggleFeature,
		save,
		revert,
		resetToDefaults,
		close,
	} = useAgentConfigStore();
	const {
		collapseSidebar,
		containerRef,
		expandSidebar,
		gridTemplateColumns,
		handleResizeStart,
		isCompactSplitLayout,
		isDesktop,
		isSidebarCollapsed,
		sidebarOverlayWidth,
	} = useAgentsWorkspacePanels();
	const { memoryTopic, setMemoryTopic } = useAgentMemoryTopic(selectedPresetId);
	const agentCronJobs = useAgentCronJobs(selectedPresetId);

	const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
	const [isAgentWizardMode, setIsAgentWizardMode] = React.useState(false);
	const [isWizardTemplateChooserOpen, setIsWizardTemplateChooserOpen] =
		React.useState(false);
	const [isSavingPage, setIsSavingPage] = React.useState(false);
	const [isMemoryTypeDialogOpen, setIsMemoryTypeDialogOpen] =
		React.useState(false);
	const [activeCompactTab, setActiveCompactTab] = React.useState("list");
	const [draftMemoryOptions, setDraftMemoryOptions] =
		React.useState<CreateAgentTopicOptions>({
			growType: DEFAULT_GROW_TYPE,
			recallType: DEFAULT_RECALL_TYPE,
		});
	const [wizardInitialDraft, setWizardInitialDraft] =
		React.useState<AgentWizardDraft | null>(null);
	const [wizardInitialMessage, setWizardInitialMessage] = React.useState<
		string | undefined
	>(undefined);
	const didAutoOpenWizardRef = React.useRef(false);

	const hasUnsavedChanges =
		hasMetadataChanges || hasConfigChanges || agentCronJobs.hasChanges;
	useUnsavedAgentWorkspaceGuard(hasUnsavedChanges);

	React.useEffect(() => {
		close();
	}, [close]);

	React.useEffect(() => {
		if (!selectedPresetId) return;
		void initialize(selectedPresetId);
	}, [initialize, selectedPresetId]);

	React.useEffect(() => {
		if (location.pathname !== "/agents" || isPresetListLoading) return;

		const requestedPresetId = (
			location.state as { selectedAgentFlowId?: string | null } | null
		)?.selectedAgentFlowId;
		if (!requestedPresetId || requestedPresetId === "chat") return;

		const requestedPreset = presets.find(
			(preset) => preset.id === requestedPresetId,
		);
		if (!requestedPreset) return;

		if (requestedPresetId !== selectedPresetId) {
			if (
				hasUnsavedChanges &&
				!window.confirm(t("agents:confirm.discardSelection"))
			) {
				navigate(`${location.pathname}${location.search}`, {
					replace: true,
					state: null,
				});
				return;
			}
			selectPreset(requestedPresetId);
		}

		setSearchQuery("");
		setIsAgentWizardMode(false);
		setActiveCompactTab("config");
		navigate(`${location.pathname}${location.search}`, {
			replace: true,
			state: null,
		});
	}, [
		hasUnsavedChanges,
		isPresetListLoading,
		location.pathname,
		location.search,
		location.state,
		navigate,
		presets,
		selectPreset,
		selectedPresetId,
		t,
	]);

	const configSummary = useAgentConfigSummary({
		availableTools,
		currentGraphType,
		draftConfig,
		draftFeatures,
		draftMultiAgentAccessibleAgentIds,
		featureDefinitions,
		selectedPreset,
	});

	const isBusy =
		isPresetListLoading ||
		isConfigLoading ||
		isCreating ||
		isDeleting ||
		isSavingMetadata ||
		isConfigSaving ||
		agentCronJobs.isLoading ||
		agentCronJobs.isSaving ||
		isSavingPage;

	const canSave =
		Boolean(selectedPresetId) &&
		Boolean(metadataDraft.name.trim()) &&
		(hasMetadataChanges ||
			hasConfigChanges ||
			agentCronJobs.hasChanges ||
			metadataDraft.status === "draft") &&
		!isLegacyConfig &&
		!isBusy;

	const handlePresetSelection = React.useCallback(
		(presetId: string) => {
			if (presetId === selectedPresetId) return;
			if (
				hasUnsavedChanges &&
				!window.confirm(t("agents:confirm.discardSelection"))
			)
				return;
			selectPreset(presetId);
			if (!isDesktop) setActiveCompactTab("config");
		},
		[hasUnsavedChanges, isDesktop, selectPreset, selectedPresetId, t],
	);

	const handleCreatePreset = React.useCallback(
		async (name: string, options?: CreateAgentOptions) => {
			if (
				hasUnsavedChanges &&
				!window.confirm(t("agents:confirm.discardSelection"))
			)
				return null;
			const created = await createPreset(
				name,
				options ?? {
					growType: DEFAULT_GROW_TYPE,
					recallType: DEFAULT_RECALL_TYPE,
					status: "active",
				},
			);
			if (!isDesktop) setActiveCompactTab("config");
			return created;
		},
		[createPreset, hasUnsavedChanges, isDesktop, t],
	);

	const applyWizardDraftToEditor = React.useCallback(
		(draft: AgentWizardDraft) => {
			setIsWizardTemplateChooserOpen(false);
			updateMetadataField(
				"name",
				draft.name || t("agents:wizard.draftAgentName"),
			);
			updateMetadataField("description", draft.description);
			updateMetadataField("status", draft.status);
			updateMetadataField("iconScreen", draft.iconScreen);

			const state = useAgentConfigStore.getState();
			if (state.currentGraphType !== draft.graphType) {
				setGraphType(draft.graphType);
			}

			const nextState = useAgentConfigStore.getState();
			nextState.updateField("systemPrompt", draft.systemPrompt);
			nextState.updateField("contextPrompt", draft.contextPrompt);
			nextState.updateField("tools", draft.enabledToolNames);
			nextState.updateField("retrievalMode", draft.recallType);
			setDraftMemoryOptions({
				growType: draft.growType,
				recallType: draft.recallType,
			});
			setEnabledSkills(draft.enabledSkillNames);
			setMCPServers(draft.mcpServers);
			setAccessibleAgents(draft.multiAgentAccessibleAgentIds);
			agentCronJobs.replaceDrafts(
				draft.cronJobs.map((cronJob) => ({
					...cronJob,
					status:
						draft.status === "draft" && cronJob.status === "active"
							? "draft"
							: cronJob.status,
				})),
			);

			const enabledFeatures = new Set(draft.enabledFeatureNames);
			for (const feature of useAgentConfigStore.getState().featureDefinitions) {
				if (feature.detailView?.some((s) => s.component === "ToolPicker"))
					continue;
				const shouldEnable = enabledFeatures.has(feature.name);
				if (
					Boolean(
						useAgentConfigStore.getState().draftFeatures[feature.name],
					) !== shouldEnable
				) {
					toggleFeature(feature.name);
				}
			}
		},
		[
			setAccessibleAgents,
			setEnabledSkills,
			setGraphType,
			setMCPServers,
			agentCronJobs,
			t,
			toggleFeature,
			updateMetadataField,
		],
	);

	const buildCurrentAgentWizardDraft =
		React.useCallback((): AgentWizardDraft => {
			const enabledFeatureNames = new Set<string>();
			for (const feature of featureDefinitions) {
				if (feature.detailView?.some((s) => s.component === "ToolPicker")) {
					if (
						draftConfig.tools.length > 0 ||
						draftMultiAgentAccessibleAgentIds.length > 0
					) {
						enabledFeatureNames.add(feature.name);
					}
				} else if (draftFeatures[feature.name]) {
					enabledFeatureNames.add(feature.name);
				}
			}

			return {
				name: metadataDraft.name,
				description: metadataDraft.description,
				status: metadataDraft.status,
				graphType: currentGraphType,
				systemPrompt: draftConfig.systemPrompt,
				contextPrompt: draftConfig.contextPrompt,
				enabledFeatureNames: [...enabledFeatureNames],
				enabledToolNames: [...draftConfig.tools],
				enabledSkillNames: [...draftEnabledSkillNames],
				mcpServers: [...draftMCPServers],
				multiAgentAccessibleAgentIds: [...draftMultiAgentAccessibleAgentIds],
				growType: draftMemoryOptions.growType,
				recallType: draftMemoryOptions.recallType,
				templateId: null,
				iconScreen: metadataDraft.iconScreen,
				cronJobs: agentCronJobs.drafts,
			};
		}, [
			agentCronJobs.drafts,
			currentGraphType,
			draftConfig.contextPrompt,
			draftConfig.systemPrompt,
			draftConfig.tools,
			draftEnabledSkillNames,
			draftFeatures,
			draftMCPServers,
			draftMemoryOptions.growType,
			draftMemoryOptions.recallType,
			draftMultiAgentAccessibleAgentIds,
			featureDefinitions,
			metadataDraft.description,
			metadataDraft.iconScreen,
			metadataDraft.name,
			metadataDraft.status,
		]);

	const handleOpenAgentWizard = React.useCallback(async () => {
		setWizardInitialDraft(null);
		setWizardInitialMessage(undefined);
		const created = await handleCreatePreset(
			t("agents:wizard.draftAgentName"),
			{
				growType: DEFAULT_GROW_TYPE,
				recallType: DEFAULT_RECALL_TYPE,
				status: "draft",
			},
		);
		if (!created) return;
		await refreshPresets(created.id);
		setIsAgentWizardMode(true);
		setIsWizardTemplateChooserOpen(true);
		updateMetadataField("status", "draft");
		if (!isDesktop) setActiveCompactTab("config");
	}, [handleCreatePreset, isDesktop, refreshPresets, t, updateMetadataField]);

	const handleOptimizeCurrentAgent = React.useCallback(() => {
		if (!selectedPresetId || isLegacyConfig || isBusy) return;
		setWizardInitialDraft(buildCurrentAgentWizardDraft());
		setWizardInitialMessage(t("agents:wizard.optimizeInitialMessage"));
		setIsAgentWizardMode(true);
		setIsWizardTemplateChooserOpen(false);
		if (!isDesktop) setActiveCompactTab("list");
	}, [
		buildCurrentAgentWizardDraft,
		isBusy,
		isDesktop,
		isLegacyConfig,
		selectedPresetId,
		t,
	]);

	const handleWizardCreated = React.useCallback(
		async (flowId: string) => {
			await refreshPresets(flowId);
			setIsAgentWizardMode(false);
			if (!isDesktop) setActiveCompactTab("config");
		},
		[isDesktop, refreshPresets],
	);

	const agentWizard = useAgentWizard({
		open: isAgentWizardMode,
		createPreset: handleCreatePreset,
		onCreated: handleWizardCreated,
		onClose: () => {
			setIsAgentWizardMode(false);
			setIsWizardTemplateChooserOpen(false);
			setWizardInitialDraft(null);
			setWizardInitialMessage(undefined);
		},
		shouldConfirmClose: hasUnsavedChanges,
		onDraftChange: applyWizardDraftToEditor,
		initialDraft: wizardInitialDraft,
		initialAssistantMessage: wizardInitialMessage,
	});

	React.useEffect(() => {
		if (
			location.pathname !== "/agents" ||
			(location.state as { openAgentWizard?: boolean } | null)
				?.openAgentWizard !== true ||
			didAutoOpenWizardRef.current ||
			isPresetListLoading ||
			isAgentWizardMode
		) {
			return;
		}

		didAutoOpenWizardRef.current = true;
		void handleOpenAgentWizard();
	}, [
		handleOpenAgentWizard,
		isAgentWizardMode,
		isPresetListLoading,
		location.pathname,
		location.state,
	]);

	const handleSelectWizardTemplate = React.useCallback(
		(template: Parameters<typeof agentWizard.applyTemplate>[0]) => {
			agentWizard.applyTemplate(template);
			setIsWizardTemplateChooserOpen(false);
		},
		[agentWizard],
	);

	const handleSavePage = React.useCallback(
		async (memoryOptionsOverride?: CreateAgentTopicOptions) => {
			if (!canSave || !selectedPresetId) return;
			const isPublishingDraft = metadataDraft.status === "draft";
			if (isPublishingDraft && !memoryTopic && !memoryOptionsOverride) {
				setIsMemoryTypeDialogOpen(true);
				return;
			}

			const memoryOptions = memoryOptionsOverride ?? draftMemoryOptions;
			setIsSavingPage(true);
			try {
				if (hasMetadataChanges || isPublishingDraft) {
					await serviceManager.flowBuilderService.updateFlowMetadata(
						selectedPresetId,
						{
							name: metadataDraft.name,
							description: metadataDraft.description,
							status: isPublishingDraft ? "active" : metadataDraft.status,
							metadata: metadataWithAgentIconScreen(
								selectedPreset?.metadata,
								metadataDraft.iconScreen,
							),
						},
					);
				}
				if (hasConfigChanges) await save();
				if (agentCronJobs.hasChanges || isPublishingDraft) {
					await agentCronJobs.save({ activateDrafts: isPublishingDraft });
				}
				if (isPublishingDraft) {
					const existingTopic =
						await topicService.getTopicByAgentId(selectedPresetId);
					if (!existingTopic) {
						const createdTopic = await topicService.createTopic({
							name: metadataDraft.name,
							description: metadataDraft.description,
							agentId: selectedPresetId,
							growType: memoryOptions.growType,
							recallType: memoryOptions.recallType,
						});
						setMemoryTopic(createdTopic);
					} else {
						setMemoryTopic(existingTopic);
					}
					updateMetadataField("status", "active");
				}
				await refreshPresets(selectedPresetId);
				if (isPublishingDraft) {
					useChatStore.getState().setSelectedAgentFlowId(selectedPresetId);
					navigate("/", {
						state: { selectedAgentFlowId: selectedPresetId },
					});
				}
			} finally {
				setIsSavingPage(false);
			}
		},
		[
			canSave,
			agentCronJobs,
			draftMemoryOptions,
			hasConfigChanges,
			hasMetadataChanges,
			memoryTopic,
			metadataDraft.description,
			metadataDraft.iconScreen,
			metadataDraft.name,
			metadataDraft.status,
			navigate,
			refreshPresets,
			save,
			selectedPreset?.metadata,
			selectedPresetId,
			setMemoryTopic,
			updateMetadataField,
		],
	);

	const handleRevertPage = React.useCallback(() => {
		revertMetadata();
		revert();
		agentCronJobs.revert();
	}, [agentCronJobs, revert, revertMetadata]);

	const handleDeletePreset = React.useCallback(
		async (options?: { deleteLinkedMemory: boolean }) => {
			try {
				if (options?.deleteLinkedMemory && memoryTopic) {
					await topicService.deleteTopic(memoryTopic.id);
					setMemoryTopic(null);
				}
			} catch (error) {
				logError("[Agents] Failed to delete linked memory topic:", error);
				window.alert(t("agents:delete.linkedMemoryDeleteFailed"));
				return;
			}
			await deleteSelectedPreset();
		},
		[deleteSelectedPreset, memoryTopic, setMemoryTopic, t],
	);

	const formActions: AgentConfigFormActions | undefined = selectedPreset
		? {
				canSave,
				isBusy,
				hasUnsavedChanges,
				saveLabel:
					metadataDraft.status === "draft"
						? t("agents:actions.submit")
						: undefined,
				canOptimize: Boolean(selectedPresetId) && !isLegacyConfig && !isBusy,
				onOptimize: handleOptimizeCurrentAgent,
				canDelete: canDeleteSelectedPreset,
				isDeleting,
				onSave: () => void handleSavePage(),
				onRevert: handleRevertPage,
				onDelete: (options) => void handleDeletePreset(options),
				onResetConfig: resetToDefaults,
			}
		: undefined;

	return {
		activeCompactTab,
		agentWizard,
		configSummary,
		cronJobs: {
			drafts: agentCronJobs.drafts,
			isLoading: agentCronJobs.isLoading,
			isSaving: agentCronJobs.isSaving,
			error: agentCronJobs.error,
			onAdd: agentCronJobs.addDraft,
			onUpdate: agentCronJobs.updateDraft,
			onRemove: agentCronJobs.removeDraft,
		},
		containerRef,
		collapseSidebar,
		draftMemoryOptions,
		error,
		expandSidebar,
		filteredPresets,
		formActions,
		gridTemplateColumns,
		handleCreatePreset,
		handleOpenAgentWizard,
		handlePresetSelection,
		handleResizeStart,
		handleSavePage,
		handleSelectWizardTemplate,
		isAgentWizardMode,
		isCompactSplitLayout,
		isCreateDialogOpen,
		isCreating,
		isDesktop,
		isSidebarCollapsed,
		isMemoryTypeDialogOpen,
		isPresetListLoading,
		isSavingPage,
		isWizardTemplateChooserOpen,
		memoryTopic,
		metadataDraft,
		searchQuery,
		selectedPreset,
		selectedPresetId,
		setActiveCompactTab,
		setDraftMemoryOptions,
		setIsCreateDialogOpen,
		setIsMemoryTypeDialogOpen,
		setSearchQuery,
		sidebarOverlayWidth,
		updateMetadataField,
	};
};
