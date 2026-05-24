import React from "react";
import { nanoid } from "nanoid";
import { serviceManager } from "@/services";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import {
	useAgentConfigStore,
	type AgentFeatureDefinition,
} from "@/main/stores/agent-config";
import { chatService } from "@/main/modules/chat/services/chat-service";
import { listDefaultSkills } from "@/services/filesystem/default-skills";
import type { Flow } from "@/services/database/types";
import type { ChatMessage } from "@/types/openai";
import { logError } from "@/utils/logger";
import { isUuid } from "@/utils/uuid";
import type {
	AgentWizardCatalog,
	AgentWizardDraft,
	AgentWizardMessage,
	AgentWizardTemplate,
} from "../types";
import { metadataWithAgentIconScreen } from "@/main/modules/agents/types";
import {
	AGENT_WIZARD_TEMPLATES,
	createBlankAgentWizardDraft,
	draftFromTemplate,
} from "../templates/agent-wizard-templates";
import {
	agentWizardToolPatchFromCall,
	applyAgentWizardPatch,
	applyAgentWizardToolPatch,
} from "../utils/apply-agent-wizard-patch";
import {
	buildAgentWizardTools,
	buildAgentWizardSystemPrompt,
	isAgentWizardToolName,
} from "../utils/build-agent-wizard-prompt";

type CreatePreset = (
	name: string,
	options: Pick<AgentWizardDraft, "growType" | "recallType" | "status">,
) => Promise<Flow | null>;

interface UseAgentWizardOptions {
	open: boolean;
	createPreset: CreatePreset;
	onCreated: (flowId: string) => Promise<void> | void;
	onClose: () => void;
	shouldConfirmClose?: boolean;
	onDraftChange?: (draft: AgentWizardDraft) => void;
	initialDraft?: AgentWizardDraft | null;
	initialAssistantMessage?: string;
}

const MAX_AGENT_WIZARD_TOOL_ROUNDS = 6;

const getCatalog = (): AgentWizardCatalog => {
	const flowCatalog = serviceManager.flowBuilderService.getCatalog();
	const featureNames = flowCatalog.steps
		.filter(
			(step) =>
				step.type === "feature" &&
				(step.graphTypes?.includes("foundation") ?? false) &&
				!(step.metadata as { legacy?: boolean }).legacy,
		)
		.map((step) => step.name);
	const toolNames = new Set<string>();
	for (const step of flowCatalog.steps) {
		const metadata = step.metadata as { tools?: unknown } | undefined;
		if (Array.isArray(metadata?.tools)) {
			for (const toolName of metadata.tools) {
				if (typeof toolName === "string") toolNames.add(toolName);
			}
		}
	}
	return {
		featureNames: [...new Set(featureNames)],
		toolNames: [...toolNames],
		skillNames: listDefaultSkills().map((skill) => skill.name),
	};
};

const createAssistantMessage = (content: string): AgentWizardMessage => ({
	id: nanoid(),
	role: "assistant",
	content,
	createdAt: new Date(),
});

const applyToolCallsToDraft = (
	draft: AgentWizardDraft,
	toolCalls: NonNullable<
		Awaited<ReturnType<typeof chatService.chatStream>>["toolCalls"]
	>,
	catalog: AgentWizardCatalog,
): { draft: AgentWizardDraft; notes: string[] } => {
	let nextDraft = draft;
	const notes: string[] = [];
	for (const toolCall of toolCalls) {
		if (!isAgentWizardToolName(toolCall.function.name)) continue;
		try {
			const args = JSON.parse(toolCall.function.arguments) as Record<
				string,
				unknown
			>;
			const patch = agentWizardToolPatchFromCall(toolCall.function.name, args);
			if (!patch) {
				notes.push(`Ignored invalid ${toolCall.function.name} call.`);
				continue;
			}
			const applied = applyAgentWizardToolPatch(nextDraft, patch, catalog);
			nextDraft = applied.draft;
			notes.push(...applied.notes);
		} catch (error) {
			logError("[AgentWizard] Failed to parse draft patch:", error);
			notes.push("Ignored an invalid draft update from the model.");
		}
	}
	return { draft: nextDraft, notes };
};

const createToolResultContent = (notes: string[]): string =>
	JSON.stringify({
		status: "applied",
		notes,
	});

const appendVisibleContent = (current: string, next: string): string => {
	const trimmedNext = next.trim();
	if (!trimmedNext) return current;
	const trimmedCurrent = current.trim();
	return trimmedCurrent ? `${trimmedCurrent}\n\n${trimmedNext}` : trimmedNext;
};

const formatToolCallForVisibleMessage = (
	toolCall: NonNullable<
		Awaited<ReturnType<typeof chatService.chatStream>>["toolCalls"]
	>[number],
	notes: string[],
): string => {
	let args: unknown = toolCall.function.arguments;
	try {
		args = JSON.parse(toolCall.function.arguments);
	} catch {
		// Keep the raw arguments string when the model emitted invalid JSON.
	}

	return [
		"```memorall_tool_call",
		JSON.stringify(
			{
				name: toolCall.function.name,
				args,
				status: "applied",
				notes,
			},
			null,
			2,
		),
		"```",
	].join("\n");
};

const setFeatureEnabled = (
	feature: AgentFeatureDefinition,
	enabled: boolean,
): void => {
	const state = useAgentConfigStore.getState();
	if (Boolean(state.draftFeatures[feature.name]) !== enabled) {
		state.toggleFeature(feature.name);
	}
};

const persistDraftToFlow = async (
	flowId: string,
	draft: AgentWizardDraft,
): Promise<void> => {
	const store = useAgentConfigStore.getState();
	await store.initialize(flowId);
	const initialized = useAgentConfigStore.getState();

	if (initialized.currentGraphType !== draft.graphType) {
		initialized.setGraphType(draft.graphType);
	}

	const state = useAgentConfigStore.getState();
	state.updateField("systemPrompt", draft.systemPrompt);
	state.updateField("contextPrompt", draft.contextPrompt);
	state.updateField("tools", draft.enabledToolNames);
	state.updateField("retrievalMode", draft.recallType);
	state.setEnabledSkills(draft.enabledSkillNames);
	state.setMCPServers(draft.mcpServers);
	state.setAccessibleAgents(draft.multiAgentAccessibleAgentIds);

	const enabledFeatures = new Set(draft.enabledFeatureNames);
	for (const feature of useAgentConfigStore.getState().featureDefinitions) {
		if (feature.detailView?.some((s) => s.component === "ToolPicker")) continue;
		setFeatureEnabled(feature, enabledFeatures.has(feature.name));
	}

	await useAgentConfigStore.getState().save();

	await serviceManager.cronJobService.saveManyForAgent(
		flowId,
		draft.cronJobs.map((cronJob) => ({
			id: isUuid(cronJob.id) ? cronJob.id : undefined,
			name: cronJob.name,
			status: cronJob.status,
			scheduleExpression: cronJob.scheduleExpression,
			timezone: cronJob.timezone,
			actionType: "agent_chat" as const,
			actionPayload: {
				prompt: cronJob.prompt,
				agentFlowId: flowId,
			},
			agentFlowId: flowId,
			conversationId: cronJob.conversationId ?? null,
			allowOverlap: cronJob.allowOverlap,
			metadata: cronJob.metadata ?? {},
		})),
		{ activateDrafts: draft.status === "active" },
	);
};

export const useAgentWizard = ({
	open,
	createPreset,
	onCreated,
	onClose,
	shouldConfirmClose = false,
	onDraftChange,
	initialDraft,
	initialAssistantMessage,
}: UseAgentWizardOptions) => {
	const { model, isInitialized } = useCurrentModel();
	const [draft, setDraft] = React.useState<AgentWizardDraft>(
		createBlankAgentWizardDraft,
	);
	const [messages, setMessages] = React.useState<AgentWizardMessage[]>([]);
	const [inputValue, setInputValue] = React.useState("");
	const [isStreaming, setIsStreaming] = React.useState(false);
	const [isCreating, setIsCreating] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [hasUserEdited, setHasUserEdited] = React.useState(false);
	const abortControllerRef = React.useRef<AbortController | null>(null);
	const draftRef = React.useRef<AgentWizardDraft>(
		createBlankAgentWizardDraft(),
	);
	const catalog = React.useMemo(getCatalog, []);

	React.useEffect(() => {
		if (!open) return;
		const nextDraft = initialDraft ?? createBlankAgentWizardDraft();
		draftRef.current = nextDraft;
		setDraft(nextDraft);
		setMessages([
			createAssistantMessage(
				initialAssistantMessage ??
					"Tell me what kind of agent you want to build, or choose a template on the right. I will update the editable draft agent before you save it.",
			),
		]);
		setInputValue("");
		setError(null);
		setHasUserEdited(false);
	}, [open]);

	const applyTemplate = React.useCallback(
		(template: AgentWizardTemplate) => {
			if (
				hasUserEdited &&
				!window.confirm(
					"Switching templates will replace the current wizard draft. Continue?",
				)
			) {
				return;
			}
			const nextDraft = draftFromTemplate(template);
			const applied = applyAgentWizardPatch(nextDraft, nextDraft, catalog);
			draftRef.current = applied.draft;
			setDraft(applied.draft);
			onDraftChange?.(applied.draft);
			setHasUserEdited(template.id !== "blank");
			setMessages((prev) => [
				...prev,
				createAssistantMessage(
					template.id === "blank"
						? "Blank draft selected. Describe the agent and I will configure it."
						: `${template.name} selected. You can edit the details directly or ask me to adjust the prompt, features, skills, or tools.`,
				),
			]);
		},
		[catalog, hasUserEdited, onDraftChange],
	);

	const submitMessage = React.useCallback(
		async (event?: React.FormEvent) => {
			event?.preventDefault();
			const content = inputValue.trim();
			if (!content || isStreaming || !model) return;

			const userMessage: AgentWizardMessage = {
				id: nanoid(),
				role: "user",
				content,
				createdAt: new Date(),
			};
			const assistantId = nanoid();
			const assistantMessage: AgentWizardMessage = {
				id: assistantId,
				role: "assistant",
				content: "",
				createdAt: new Date(),
			};
			const nextMessages = [...messages, userMessage, assistantMessage];
			setMessages(nextMessages);
			setInputValue("");
			setIsStreaming(true);
			setError(null);
			setHasUserEdited(true);

			const controller = new AbortController();
			abortControllerRef.current = controller;

			const chatMessages: ChatMessage[] = [
				{
					role: "system",
					content: buildAgentWizardSystemPrompt(catalog, draftRef.current),
				},
				...messages
					.filter((message) => message.role !== "system")
					.map((message) => ({
						role: message.role as "user" | "assistant",
						content: message.content,
					})),
				{ role: "user", content },
			];

			try {
				let workingMessages = chatMessages;
				let visibleContent = "";
				const accumulatedNotes: string[] = [];

				for (let round = 0; round < MAX_AGENT_WIZARD_TOOL_ROUNDS; round++) {
					workingMessages = [
						{
							role: "system",
							content: buildAgentWizardSystemPrompt(catalog, draftRef.current),
						},
						...workingMessages.filter((message) => message.role !== "system"),
					];

					const result = await chatService.chatStream(
						{
							messages: workingMessages,
							model,
							mode: "normal",
							tools: buildAgentWizardTools(),
							tool_choice: "auto",
							parallel_tool_calls: true,
							streamConfig: {
								minWordsToStream: 5,
								streamToolCallsImmediately: true,
							},
						},
						{
							onContent: (streamedContent) => {
								const nextVisibleContent = appendVisibleContent(
									visibleContent,
									streamedContent,
								);
								setMessages((prev) =>
									prev.map((message) =>
										message.id === assistantId
											? { ...message, content: nextVisibleContent }
											: message,
									),
								);
							},
						},
						controller.signal,
					);

					if (result.failed) {
						throw new Error(result.error || "Agent builder chat failed");
					}

					visibleContent = appendVisibleContent(visibleContent, result.content);

					if (!result.toolCalls?.length) {
						break;
					}

					const applied = applyToolCallsToDraft(
						draftRef.current,
						result.toolCalls,
						catalog,
					);
					draftRef.current = applied.draft;
					setDraft(applied.draft);
					onDraftChange?.(applied.draft);
					accumulatedNotes.push(...applied.notes);
					visibleContent = appendVisibleContent(
						visibleContent,
						result.toolCalls
							.map((toolCall) =>
								formatToolCallForVisibleMessage(toolCall, applied.notes),
							)
							.join("\n\n"),
					);
					visibleContent = appendVisibleContent(
						visibleContent,
						"Draft changes applied. I am checking whether any other updates are needed.",
					);
					setMessages((prev) =>
						prev.map((message) =>
							message.id === assistantId
								? { ...message, content: visibleContent }
								: message,
						),
					);

					workingMessages = [
						...workingMessages,
						{
							role: "assistant",
							content: result.content || null,
							tool_calls: result.toolCalls,
						},
						...result.toolCalls.map(
							(toolCall): ChatMessage => ({
								role: "tool",
								tool_call_id: toolCall.id,
								content: createToolResultContent(applied.notes),
							}),
						),
					];
				}

				setMessages((prev) =>
					prev.map((message) =>
						message.id === assistantId
							? {
									...message,
									content:
										visibleContent ||
										(accumulatedNotes.length > 0
											? `Draft updated.\n${accumulatedNotes.join("\n")}`
											: "Draft updated."),
								}
							: message,
					),
				);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Agent builder chat failed";
				logError("[AgentWizard] Chat failed:", err);
				setError(message);
				setMessages((prev) =>
					prev.map((item) =>
						item.id === assistantId
							? { ...item, content: "I could not update the draft. Try again." }
							: item,
					),
				);
			} finally {
				setIsStreaming(false);
				abortControllerRef.current = null;
			}
		},
		[catalog, draft, inputValue, isStreaming, messages, model, onDraftChange],
	);

	const stop = React.useCallback(() => {
		abortControllerRef.current?.abort();
		setIsStreaming(false);
	}, []);

	const createAgent = React.useCallback(async () => {
		if (!draft.name.trim() || isCreating) return;
		setIsCreating(true);
		setError(null);
		try {
			const created = await createPreset(draft.name.trim(), {
				growType: draft.growType,
				recallType: draft.recallType,
				status: draft.status,
			});
			if (!created) throw new Error("Failed to create agent");

			if (
				draft.description.trim() ||
				draft.status !== "active" ||
				draft.iconScreen
			) {
				await serviceManager.flowBuilderService.updateFlowMetadata(created.id, {
					name: draft.name.trim(),
					description: draft.description,
					status: draft.status,
					metadata: metadataWithAgentIconScreen(
						created.metadata,
						draft.iconScreen,
					),
				});
			}

			await persistDraftToFlow(created.id, draft);
			await onCreated(created.id);
			onClose();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to create agent";
			logError("[AgentWizard] Create failed:", err);
			setError(message);
		} finally {
			setIsCreating(false);
		}
	}, [createPreset, draft, isCreating, onClose, onCreated]);

	const requestClose = React.useCallback(() => {
		if (
			shouldConfirmClose &&
			!window.confirm("Discard this agent wizard draft and close?")
		) {
			return;
		}
		onClose();
	}, [onClose, shouldConfirmClose]);

	return {
		templates: AGENT_WIZARD_TEMPLATES,
		catalog,
		draft,
		messages,
		inputValue,
		setInputValue,
		isStreaming,
		isCreating,
		isModelReady: isInitialized && Boolean(model),
		error,
		applyTemplate,
		submitMessage,
		stop,
		createAgent,
		requestClose,
		canCreate: Boolean(draft.name.trim()) && !isCreating,
	};
};
