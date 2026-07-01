import React from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { CreateFlowDialog } from "@/main/modules/flow-builder/components";
import { Button } from "@/main/components/ui/button";
import { Separator } from "@/main/components/ui/separator";
import {
	AgentWizardChatPanel,
	AgentWizardTemplatePanel,
} from "@/main/modules/agent-wizard";
import { AgentPresetList } from "./AgentPresetList";
import { AgentConfigForm } from "./AgentConfigForm";
import {
	AgentMemoryTypeDialog,
	AgentMemoryTypeFields,
	type CreateAgentTopicOptions,
} from "./AgentMemoryTypeControls";
import { AgentsWorkspaceLayout } from "./AgentsWorkspaceLayout";
import { useAgentsWorkspaceController } from "../hooks/use-agents-workspace-controller";
import { cn } from "@/lib/utils";

export const AgentsWorkspace: React.FC = () => {
	const { t } = useTranslation(["agents", "chat", "common"]);
	const {
		activeCompactTab,
		agentWizard,
		filteredPresets,
		selectedPreset,
		selectedPresetId,
		searchQuery,
		metadataDraft,
		isPresetListLoading,
		isCreating,
		error,
		setSearchQuery,
		updateMetadataField,
		configSummary,
		cronJobs,
		collapseSidebar,
		containerRef,
		draftMemoryOptions,
		expandSidebar,
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
		isDesktop,
		isSidebarCollapsed,
		isMemoryTypeDialogOpen,
		isSavingPage,
		isWizardTemplateChooserOpen,
		memoryTopic,
		setActiveCompactTab,
		setDraftMemoryOptions,
		setIsCreateDialogOpen,
		setIsMemoryTypeDialogOpen,
		sidebarOverlayWidth,
	} = useAgentsWorkspaceController();

	// ── Panel sections ────────────────────────────────────────────────────────
	const listSection = (
		<section
			className={cn(
				"min-h-0",
				isDesktop ? "h-full max-h-full overflow-hidden bg-background" : "",
			)}
		>
			{isAgentWizardMode ? (
				<AgentWizardChatPanel
					messages={agentWizard.messages}
					inputValue={agentWizard.inputValue}
					onInputChange={agentWizard.setInputValue}
					onSubmit={agentWizard.submitMessage}
					onStop={agentWizard.stop}
					onBack={agentWizard.requestClose}
					isStreaming={agentWizard.isStreaming}
					isModelReady={agentWizard.isModelReady}
				/>
			) : (
				<AgentPresetList
					presets={filteredPresets}
					selectedPresetId={selectedPresetId}
					searchQuery={searchQuery}
					isLoading={isPresetListLoading}
					isCreating={isCreating}
					compactHeaderActions={!isDesktop}
					scrollMode={isDesktop ? "contained" : "page"}
					onSearchChange={setSearchQuery}
					onSelectPreset={handlePresetSelection}
					onCreatePreset={() => setIsCreateDialogOpen(true)}
				/>
			)}
		</section>
	);

	const configSection = (
		<section
			className={cn(
				"min-h-0",
				isDesktop ? "h-full max-h-full overflow-hidden bg-background" : "",
			)}
		>
			<div className={cn("flex flex-col", isDesktop ? "h-full min-h-0" : "")}>
				{isAgentWizardMode ? (
					<div
						className={cn("min-h-0", isDesktop ? "flex-1 overflow-y-auto" : "")}
					>
						{isWizardTemplateChooserOpen ? (
							<AgentWizardTemplatePanel
								templates={agentWizard.templates}
								selectedTemplateId={agentWizard.draft.templateId}
								onSelectTemplate={handleSelectWizardTemplate}
								error={agentWizard.error}
							/>
						) : selectedPreset ? (
							<AgentConfigForm
								className="p-4 sm:p-5"
								metadataDraft={metadataDraft}
								configSummary={configSummary}
								memoryTopic={memoryTopic}
								onMetadataChange={updateMetadataField}
								formActions={formActions}
								cronJobs={cronJobs}
							/>
						) : (
							<div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
								{t("agents:wizard.creatingDraftAgent")}
							</div>
						)}
					</div>
				) : (
					<>
						{selectedPreset ? (
							<div
								className={cn(
									isDesktop ? "flex-1 min-h-0 overflow-y-auto" : "",
								)}
							>
								{error ? (
									<div className="px-4 pt-4 max-w-3xl mx-auto">
										<div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
											{error}
										</div>
									</div>
								) : null}
								<AgentConfigForm
									className="p-4 sm:p-5"
									metadataDraft={metadataDraft}
									configSummary={configSummary}
									memoryTopic={memoryTopic}
									onMetadataChange={updateMetadataField}
									formActions={formActions}
									cronJobs={cronJobs}
								/>
							</div>
						) : (
							<div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
								{t("overview.emptyDescription")}
							</div>
						)}
					</>
				)}
			</div>
		</section>
	);

	return (
		<AgentsWorkspaceLayout
			activeCompactTab={activeCompactTab}
			configSection={configSection}
			containerRef={containerRef}
			gridTemplateColumns={gridTemplateColumns}
			isCompactSplitLayout={isCompactSplitLayout}
			isSidebarCollapsed={isSidebarCollapsed}
			isDesktop={isDesktop}
			listSection={listSection}
			onCollapseSidebar={collapseSidebar}
			onCompactTabChange={setActiveCompactTab}
			onExpandSidebar={expandSidebar}
			onOpenAgentWizard={() => {
				void handleOpenAgentWizard();
			}}
			onResizeStart={handleResizeStart}
			sidebarOverlayWidth={sidebarOverlayWidth}
		>
			<CreateFlowDialog<CreateAgentTopicOptions>
				open={isCreateDialogOpen}
				onOpenChange={setIsCreateDialogOpen}
				onCreateFlow={(name, options) => void handleCreatePreset(name, options)}
				title={t("createDialog.title")}
				description={t("createDialog.description")}
				namePlaceholder={t("createDialog.namePlaceholder")}
				submitLabel={t("actions.create")}
				afterFooter={
					<div className="space-y-4 pt-5">
						<div className="relative flex items-center justify-center">
							<Separator />
							<span className="absolute bg-background px-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
								{t("createDialog.or")}
							</span>
						</div>
						<div className="rounded-lg border bg-muted/20 p-3">
							<div className="flex items-start gap-3">
								<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
									<Sparkles size={16} />
								</div>
								<div className="min-w-0 flex-1 space-y-1">
									<p className="text-sm font-medium">
										{t("createDialog.aiTitle")}
									</p>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{t("createDialog.aiDescription")}
									</p>
								</div>
							</div>
							<Button
								type="button"
								variant="secondary"
								className="mt-3 h-9 w-full justify-center border border-border/70 bg-background/70 hover:bg-background"
								onClick={() => {
									setIsCreateDialogOpen(false);
									void handleOpenAgentWizard();
								}}
								disabled={isCreating}
							>
								<Sparkles size={14} className="mr-1.5" />
								{t("createDialog.aiAction")}
							</Button>
						</div>
					</div>
				}
			>
				{({ resetToken, setExtra }) => (
					<AgentMemoryTypeFields resetToken={resetToken} setExtra={setExtra} />
				)}
			</CreateFlowDialog>

			<AgentMemoryTypeDialog
				open={isMemoryTypeDialogOpen}
				defaultValue={draftMemoryOptions}
				isBusy={isSavingPage}
				onOpenChange={setIsMemoryTypeDialogOpen}
				onSubmit={(options) => {
					setDraftMemoryOptions(options);
					setIsMemoryTypeDialogOpen(false);
					void handleSavePage(options);
				}}
			/>
		</AgentsWorkspaceLayout>
	);
};
