import React from "react";
import { useTranslation } from "react-i18next";
import { toAgentScreenContent } from "@/components/AgentIcon";
import { Separator } from "@/main/components/ui/separator";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import { AgentIconScreenPicker } from "../AgentIconScreenPicker";
import type { AgentConfigSummary, AgentPresetDraft } from "../../types";
import type { Topic } from "@/services/database/types";
import { AgentInlineActions } from "./AgentInlineActions";
import { AgentCompactStatsRow } from "./AgentCompactStatsRow";
import { AgentPromptPills } from "./AgentPromptPills";
import type { AgentConfigFormActions, AgentMetadataChange } from "./types";

const AgentDescriptionField: React.FC<{
	metadataDraft: AgentPresetDraft;
	onMetadataChange: AgentMetadataChange;
}> = ({ metadataDraft, onMetadataChange }) => {
	const { t } = useTranslation("agents");
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

	const resizeTextarea = React.useCallback(
		(textarea: HTMLTextAreaElement | null) => {
			if (!textarea) return;
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		},
		[],
	);

	React.useLayoutEffect(() => {
		resizeTextarea(textareaRef.current);
	}, [metadataDraft.description, resizeTextarea]);

	return (
		<CursorPoint cursorKey={AGENT_WIZARD_CURSOR_KEYS.description}>
			<textarea
				ref={textareaRef}
				id="agent-preset-description"
				value={metadataDraft.description}
				onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
					onMetadataChange("description", e.target.value);
					resizeTextarea(e.currentTarget);
				}}
				placeholder={t("fields.descriptionPlaceholder")}
				rows={1}
				className="block w-full overflow-hidden bg-transparent p-0 text-sm text-muted-foreground placeholder:text-muted-foreground/40 border-0 outline-none resize-none"
			/>
		</CursorPoint>
	);
};

const AgentNameField: React.FC<{
	metadataDraft: AgentPresetDraft;
	onMetadataChange: AgentMetadataChange;
}> = ({ metadataDraft, onMetadataChange }) => {
	const { t } = useTranslation("agents");
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

	const resizeTextarea = React.useCallback(
		(textarea: HTMLTextAreaElement | null) => {
			if (!textarea) return;
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		},
		[],
	);

	React.useLayoutEffect(() => {
		resizeTextarea(textareaRef.current);
	}, [metadataDraft.name, resizeTextarea]);

	return (
		<CursorPoint
			cursorKey={AGENT_WIZARD_CURSOR_KEYS.name}
			className="min-w-0 flex-1"
		>
			<textarea
				ref={textareaRef}
				id="agent-preset-name"
				value={metadataDraft.name}
				onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
					onMetadataChange("name", e.target.value);
					resizeTextarea(e.currentTarget);
				}}
				placeholder={t("fields.namePlaceholder")}
				rows={1}
				className="block w-full min-w-0 overflow-hidden bg-transparent p-0 text-xl font-bold leading-tight text-foreground placeholder:text-muted-foreground/40 border-0 outline-none resize-none"
			/>
		</CursorPoint>
	);
};

export const AgentIdentitySection: React.FC<{
	metadataDraft: AgentPresetDraft;
	configSummary?: AgentConfigSummary | null;
	memoryTopic?: Topic | null;
	onMetadataChange: AgentMetadataChange;
	formActions?: AgentConfigFormActions;
}> = ({
	metadataDraft,
	configSummary,
	memoryTopic,
	onMetadataChange,
	formActions,
}) => {
	const { t } = useTranslation("agents");
	const iconScreenContent = toAgentScreenContent(
		metadataDraft.iconScreen ?? null,
	);

	return (
		<>
			<div className="space-y-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<div className="order-2 flex min-w-0 items-center gap-3 sm:order-1 sm:flex-1">
						<CursorPoint cursorKey={AGENT_WIZARD_CURSOR_KEYS.iconScreen}>
							<AgentIconScreenPicker
								metadataDraft={metadataDraft}
								iconScreenContent={iconScreenContent}
								onMetadataChange={onMetadataChange}
							/>
						</CursorPoint>

						<AgentNameField
							metadataDraft={metadataDraft}
							onMetadataChange={onMetadataChange}
						/>
					</div>

					<div className="order-1 flex justify-end sm:order-2">
						<AgentInlineActions
							formActions={formActions}
							metadataDraft={metadataDraft}
							memoryTopic={memoryTopic}
						/>
					</div>
				</div>

				<AgentDescriptionField
					metadataDraft={metadataDraft}
					onMetadataChange={onMetadataChange}
				/>
				<AgentCompactStatsRow
					configSummary={configSummary}
					memoryTopic={memoryTopic}
				/>
				<AgentPromptPills configSummary={configSummary} />
			</div>

			<Separator />
		</>
	);
};
