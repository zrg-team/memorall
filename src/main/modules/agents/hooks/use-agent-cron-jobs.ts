import React from "react";
import { serviceManager } from "@/services";
import {
	getLocalTimezone,
	validateCronExpression,
	type CronJobSaveInput,
} from "@/services/cron-jobs";
import type { CronJob, CronJobStatus } from "@/services/database/types";
import { isUuid, v4 } from "@/utils/uuid";
import { logError } from "@/utils/logger";

export interface AgentCronJobDraft {
	id: string;
	name: string;
	status: CronJobStatus;
	scheduleExpression: string;
	timezone: string;
	prompt: string;
	allowOverlap: boolean;
	conversationId?: string | null;
	metadata?: Record<string, unknown>;
}

export const createDefaultDraft = (
	agentFlowId: string,
	status: CronJobStatus,
): AgentCronJobDraft => ({
	id: v4(),
	name: "Scheduled prompt",
	status,
	scheduleExpression: "0 9 * * *",
	timezone: getLocalTimezone(),
	prompt: "",
	allowOverlap: false,
	metadata: {
		scheduleMode: "daily",
		time: "09:00",
		dayOfWeek: 1,
		agentFlowId,
	},
});

const cronJobToDraft = (job: CronJob): AgentCronJobDraft => ({
	id: job.id,
	name: job.name,
	status: job.status,
	scheduleExpression: job.scheduleExpression,
	timezone: job.timezone || getLocalTimezone(),
	prompt:
		typeof job.actionPayload === "object" &&
		job.actionPayload !== null &&
		"prompt" in job.actionPayload &&
		typeof job.actionPayload.prompt === "string"
			? job.actionPayload.prompt
			: "",
	allowOverlap: job.allowOverlap,
	conversationId: job.conversationId,
	metadata: job.metadata ?? {},
});

const normalizeDraftForCompare = (draft: AgentCronJobDraft) => ({
	id: draft.id,
	name: draft.name.trim(),
	status: draft.status,
	scheduleExpression: draft.scheduleExpression.trim(),
	timezone: draft.timezone,
	prompt: draft.prompt.trim(),
	allowOverlap: draft.allowOverlap,
	conversationId: draft.conversationId ?? null,
	metadata: draft.metadata ?? {},
});

const serializeDrafts = (drafts: AgentCronJobDraft[]) =>
	JSON.stringify(drafts.map(normalizeDraftForCompare));

export const useAgentCronJobs = (agentFlowId: string | null) => {
	const [savedDrafts, setSavedDrafts] = React.useState<AgentCronJobDraft[]>([]);
	const [drafts, setDrafts] = React.useState<AgentCronJobDraft[]>([]);
	const [isLoading, setIsLoading] = React.useState(false);
	const [isSaving, setIsSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const reload = React.useCallback(async () => {
		if (!agentFlowId) {
			setSavedDrafts([]);
			setDrafts([]);
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			const rows = await serviceManager.cronJobService.listByAgent(agentFlowId);
			const next = rows.map(cronJobToDraft);
			setSavedDrafts(next);
			setDrafts(next);
		} catch (err) {
			logError("[Agents] Failed to load cron jobs:", err);
			setError(err instanceof Error ? err.message : "Failed to load schedules");
		} finally {
			setIsLoading(false);
		}
	}, [agentFlowId]);

	React.useEffect(() => {
		void reload();
	}, [reload]);

	const updateDraft = React.useCallback(
		(id: string, updates: Partial<AgentCronJobDraft>) => {
			setDrafts((prev) =>
				prev.map((draft) =>
					draft.id === id
						? {
								...draft,
								...updates,
								metadata: {
									...(draft.metadata ?? {}),
									...(updates.metadata ?? {}),
								},
							}
						: draft,
				),
			);
		},
		[],
	);

	const addDraft = React.useCallback(
		(status: CronJobStatus) => {
			if (!agentFlowId) return;
			setDrafts((prev) => [...prev, createDefaultDraft(agentFlowId, status)]);
		},
		[agentFlowId],
	);

	const removeDraft = React.useCallback((id: string) => {
		setDrafts((prev) => prev.filter((draft) => draft.id !== id));
	}, []);

	const replaceDrafts = React.useCallback((nextDrafts: AgentCronJobDraft[]) => {
		setDrafts(nextDrafts);
	}, []);

	const revert = React.useCallback(() => {
		setDrafts(savedDrafts);
	}, [savedDrafts]);

	const hasChanges = serializeDrafts(savedDrafts) !== serializeDrafts(drafts);

	const save = React.useCallback(
		async (options: { activateDrafts?: boolean } = {}) => {
			if (!agentFlowId) return [];
			const invalid = drafts.find((draft) => {
				const validation = validateCronExpression(draft.scheduleExpression);
				return !validation.valid || !draft.prompt.trim();
			});
			if (invalid) {
				throw new Error(
					"Every schedule needs a valid cron expression and prompt",
				);
			}

			setIsSaving(true);
			setError(null);
			try {
				const saved = await serviceManager.cronJobService.saveManyForAgent(
					agentFlowId,
					drafts.map(
						(draft): CronJobSaveInput => ({
							id: isUuid(draft.id) ? draft.id : undefined,
							name: draft.name,
							status: draft.status,
							scheduleExpression: draft.scheduleExpression,
							timezone: draft.timezone,
							actionType: "agent_chat",
							actionPayload: {
								prompt: draft.prompt,
								agentFlowId,
							},
							agentFlowId,
							conversationId: draft.conversationId ?? null,
							allowOverlap: draft.allowOverlap,
							metadata: draft.metadata ?? {},
						}),
					),
					options,
				);
				const next = saved.map(cronJobToDraft);
				setSavedDrafts(next);
				setDrafts(next);
				return saved;
			} catch (err) {
				logError("[Agents] Failed to save cron jobs:", err);
				setError(
					err instanceof Error ? err.message : "Failed to save schedules",
				);
				throw err;
			} finally {
				setIsSaving(false);
			}
		},
		[agentFlowId, drafts],
	);

	return {
		drafts,
		isLoading,
		isSaving,
		error,
		hasChanges,
		addDraft,
		updateDraft,
		removeDraft,
		replaceDrafts,
		revert,
		reload,
		save,
	};
};
