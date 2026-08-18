import React, { useRef, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PromptInput } from "@/main/components/ui/shadcn-io/ai/prompt-input";
import {
	MentionRichTextarea,
	type MentionRichTextareaHandle,
} from "@/main/modules/chat/components/input/MentionRichTextarea";
import { TooltipProvider } from "@/main/components/ui/tooltip";
import type { FlowMetadata } from "@/services/database/entities/flows";
import type { ChatStatus, AttachedDocumentRef } from "@/types/chat";
import type { DocumentFile } from "@/types/document-library";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { DOCUMENTS_SANDBOX_ROOT } from "@/services/filesystem/sandbox-paths";
import { skillFileSystemService } from "@/services/filesystem/skill-filesystem";
import { AttachmentList } from "@/main/modules/chat/components/input/AttachmentList";
import {
	collectFiles,
	documentFileToMentionItem,
	MentionPopup,
	type MentionItem,
} from "@/main/modules/chat/components/input/MentionPopup";
import { ChatInputControls } from "@/main/modules/chat/components/input/ChatInputControls";

export interface ChatInputProps {
	inputValue: string;
	setInputValue: (value: string) => void;
	onSubmit: (
		e: React.FormEvent,
		attachedImages: File[],
		attachedDocumentRefs: AttachedDocumentRef[],
	) => void;
	isLoading: boolean;
	model: string;
	status: ChatStatus;
	selectedTopic: string;
	setSelectedTopic: (topicId: string) => void;
	onInsertSeparator: () => void;
	onStop: () => void;
	abortController: AbortController | null;
	isLoadingTopics: boolean;
	topics: Array<{ id: string; name: string; agentId?: string | null }>;
	agentFlows: Array<{
		id: string;
		name: string;
		/** Carries the agent's icon screen; see AgentGlyph. */
		metadata?: FlowMetadata | null;
	}>;
	selectedAgentFlowId: string | null;
	setSelectedAgentFlowId: (flowId: string) => void;
	onCreateAgentFlow?: () => void;
	onDeleteChat: () => void;
	onOpenAgentSettings?: () => void;
	compactControls?: boolean;
	attachedImages: File[];
	onAttachedImagesChange: (images: File[]) => void;
	attachedDocumentRefs: AttachedDocumentRef[];
	onAttachedDocumentRefsChange: (refs: AttachedDocumentRef[]) => void;
	isModelReady?: boolean;
	isFullWidth?: boolean;
	onToggleFullWidth?: () => void;
	placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
	inputValue,
	setInputValue,
	onSubmit,
	isLoading,
	model,
	status,
	selectedTopic,
	setSelectedTopic,
	onInsertSeparator,
	onStop,
	abortController,
	isLoadingTopics,
	onDeleteChat,
	topics,
	agentFlows,
	selectedAgentFlowId,
	setSelectedAgentFlowId,
	onCreateAgentFlow,
	onOpenAgentSettings,
	compactControls = false,
	attachedImages,
	onAttachedImagesChange,
	attachedDocumentRefs,
	onAttachedDocumentRefsChange,
	isModelReady = true,
	isFullWidth = false,
	onToggleFullWidth,
	placeholder,
}) => {
	const { t } = useTranslation("chat");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<MentionRichTextareaHandle>(null);
	const composerRef = useRef<HTMLDivElement>(null);
	const isCustomMode = selectedAgentFlowId !== "chat";

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const mentionAtIndexRef = useRef<number>(-1);
	const [mentionDocFiles, setMentionDocFiles] = useState<DocumentFile[]>([]);
	const [mentionSkillItems, setMentionSkillItems] = useState<MentionItem[]>([]);
	const [mentionHighlight, setMentionHighlight] = useState(0);
	const [mentionSource, setMentionSource] = useState<"inline" | "picker">(
		"inline",
	);
	const isMentionOpen = mentionQuery !== null;

	useEffect(() => {
		if (!isMentionOpen) return;
		Promise.all([
			documentFileSystemService.getTree(DOCUMENTS_SANDBOX_ROOT).catch(() => []),
			skillFileSystemService.listSkills().catch(() => []),
		]).then(([tree, skills]) => {
			setMentionDocFiles(collectFiles(tree));
			setMentionSkillItems(
				skills.map((s) => ({
					id: `skill:${s.name}`,
					name: s.name,
					kind: "skill" as const,
					description: s.description,
				})),
			);
		});
	}, [isMentionOpen]);

	const filteredMentionItems = useMemo((): MentionItem[] => {
		if (mentionQuery === null) return [];

		// Support namespace prefixes: @skill:query or @doc:query
		let q = mentionQuery.toLowerCase();
		let kindFilter: "skill" | "document" | null = null;
		if (mentionSource === "picker") {
			kindFilter = "document";
		}
		if (q.startsWith("skill:")) {
			kindFilter = "skill";
			q = q.slice("skill:".length);
		} else if (q.startsWith("doc:")) {
			kindFilter = "document";
			q = q.slice("doc:".length);
		}

		const docItems =
			kindFilter === "skill"
				? []
				: mentionDocFiles
						.filter((f) => {
							if (!q) return true;
							const searchable = [
								f.name,
								f.path,
								f.metadata?.title,
								f.metadata?.description,
								...(f.metadata?.tags ?? []),
							]
								.filter(Boolean)
								.join(" ")
								.toLowerCase();
							return searchable.includes(q);
						})
						.map(documentFileToMentionItem);

		const skillItems =
			kindFilter === "document"
				? []
				: mentionSkillItems.filter(
						(s) =>
							!q ||
							[s.name, s.description]
								.filter(Boolean)
								.join(" ")
								.toLowerCase()
								.includes(q),
					);

		return [...skillItems, ...docItems].slice(0, 8);
	}, [mentionDocFiles, mentionSkillItems, mentionQuery, mentionSource]);

	useEffect(() => {
		setMentionHighlight(0);
	}, [filteredMentionItems.length]);

	const handleAttachClick = () => {
		fileInputRef.current?.click();
	};

	const handleOpenDocumentPicker = () => {
		mentionAtIndexRef.current = inputValue.length;
		setMentionSource("picker");
		setMentionQuery("");
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		if (files.length === 0) return;
		e.target.value = "";

		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		const documentFiles = files.filter(
			(file) => !file.type.startsWith("image/"),
		);

		if (imageFiles.length > 0) {
			onAttachedImagesChange([...attachedImages, ...imageFiles]);
		}

		if (documentFiles.length > 0) {
			void Promise.all(
				documentFiles.map(async (file) => {
					const uploaded = await documentFileSystemService.uploadFile(file);
					return {
						path: uploaded.path,
						mimeType: uploaded.mimeType || file.type,
						name: uploaded.name,
						docType: uploaded.type,
					} satisfies AttachedDocumentRef;
				}),
			).then((uploadedRefs) => {
				onAttachedDocumentRefsChange([
					...attachedDocumentRefs,
					...uploadedRefs,
				]);
			});
		}
	};

	const handleRemoveImage = (index: number) => {
		onAttachedImagesChange(attachedImages.filter((_, i) => i !== index));
	};

	const handleRemoveDocRef = (index: number) => {
		onAttachedDocumentRefsChange(
			attachedDocumentRefs.filter((_, i) => i !== index),
		);
	};

	const handleInputChange = (value: string, cursorPos: number) => {
		setInputValue(value);

		const textBefore = value.slice(0, cursorPos);
		const lastAt = textBefore.lastIndexOf("@");

		if (lastAt !== -1) {
			const candidate = textBefore.slice(lastAt + 1);
			if (!candidate.includes(" ") && !candidate.includes("\n")) {
				mentionAtIndexRef.current = lastAt;
				setMentionSource("inline");
				setMentionQuery(candidate);
				return;
			}
		}

		setMentionQuery(null);
	};

	const handleSelectMention = (item: MentionItem) => {
		const atIdx = mentionAtIndexRef.current;
		const queryLen = mentionQuery?.length ?? 0;
		setMentionQuery(null);

		const prefix =
			item.kind === "skill" ? `@skill:${item.name} ` : `@doc:${item.name} `;
		const insertAt = atIdx >= 0 ? atIdx : inputValue.length;
		const replaceEnd =
			mentionSource === "inline" ? insertAt + 1 + queryLen : insertAt;
		const spacer =
			mentionSource === "picker" && insertAt > 0 && !/\s$/.test(inputValue)
				? " "
				: "";
		const newValue =
			inputValue.slice(0, insertAt) +
			spacer +
			prefix +
			inputValue.slice(replaceEnd);
		const cursorAfter = insertAt + spacer.length + prefix.length;

		// Signal where the cursor should land before the DOM re-renders
		textareaRef.current?.setPendingCursor(cursorAfter);
		setInputValue(newValue);

		if (item.kind === "document") {
			onAttachedDocumentRefsChange([
				...attachedDocumentRefs,
				{
					path: item.id,
					mimeType: "",
					name: item.name,
					docType: item.docType ?? "other",
				},
			]);
		}
	};

	const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (isMentionOpen && filteredMentionItems.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMentionHighlight((h) =>
					Math.min(h + 1, filteredMentionItems.length - 1),
				);
				return;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMentionHighlight((h) => Math.max(h - 1, 0));
				return;
			}

			if (e.key === "Enter") {
				e.preventDefault();
				handleSelectMention(filteredMentionItems[mentionHighlight]);
				return;
			}

			if (e.key === "Escape") {
				e.preventDefault();
				setMentionQuery(null);
				return;
			}
		}
		// Enter-to-submit is handled inside MentionRichTextarea itself
	};

	const handleSubmitWithImages = (e: React.FormEvent) => {
		onSubmit(e, attachedImages, attachedDocumentRefs);
	};

	const hasAttachments =
		attachedImages.length > 0 || attachedDocumentRefs.length > 0;

	return (
		<TooltipProvider>
			<div className="relative z-10 w-full flex-shrink-0 bg-background/90 px-2 pb-3 pt-0 shadow-[0_-18px_45px_hsl(var(--background)/0.92)] backdrop-blur-xl sm:px-4 sm:pb-4">
				<div ref={composerRef} className="relative mx-auto min-w-0 max-w-4xl">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*,text/*,.md,.markdown,.txt"
						multiple
						className="hidden"
						onChange={handleFileChange}
					/>

					<MentionPopup
						isOpen={isMentionOpen}
						items={filteredMentionItems}
						highlightIndex={mentionHighlight}
						title={t("mention.documents")}
						searchText={mentionQuery ?? ""}
						anchorRef={composerRef}
						searchPlaceholder={t("mention.searchDocuments")}
						emptyText={t("mention.noMatches")}
						onSearchTextChange={
							mentionSource === "picker" ? setMentionQuery : undefined
						}
						onHighlightChange={setMentionHighlight}
						onClose={() => setMentionQuery(null)}
						onSelect={handleSelectMention}
					/>

					<PromptInput
						className="divide-border/50 rounded-[22px] border-border/70 bg-card/95 shadow-[0_18px_55px_hsl(var(--foreground)/0.10)]"
						onSubmit={handleSubmitWithImages}
					>
						<div>
							{hasAttachments && (
								<AttachmentList
									attachedImages={attachedImages}
									attachedDocumentRefs={attachedDocumentRefs}
									onRemoveImage={handleRemoveImage}
									onRemoveDocRef={handleRemoveDocRef}
								/>
							)}

							<MentionRichTextarea
								ref={textareaRef}
								value={inputValue}
								onChange={handleInputChange}
								onKeyDown={handleTextareaKeyDown}
								placeholder={
									isModelReady
										? (placeholder ?? t("input.placeholder"))
										: t("model.notLoaded")
								}
								disabled={!isModelReady}
								className="min-h-[68px] !border-0 !border-t-0 px-3 py-3 text-[15px] leading-6 !shadow-none focus:!border-0 focus:!ring-0 focus:!ring-offset-0 focus-visible:!border-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 sm:px-4"
							/>
						</div>

						<ChatInputControls
							isLoading={isLoading}
							model={model}
							status={status}
							selectedTopic={selectedTopic}
							setSelectedTopic={setSelectedTopic}
							onInsertSeparator={onInsertSeparator}
							onStop={onStop}
							abortController={abortController}
							isLoadingTopics={isLoadingTopics}
							topics={topics}
							agentFlows={agentFlows}
							selectedAgentFlowId={selectedAgentFlowId}
							setSelectedAgentFlowId={setSelectedAgentFlowId}
							onCreateAgentFlow={onCreateAgentFlow}
							onDeleteChat={onDeleteChat}
							onOpenAgentSettings={onOpenAgentSettings}
							compactControls={compactControls}
							isCustomMode={isCustomMode}
							onAttachFileClick={handleAttachClick}
							onAttachDocumentClick={handleOpenDocumentPicker}
							canSubmit={!!inputValue.trim() && isModelReady}
							isFullWidth={isFullWidth}
							onToggleFullWidth={onToggleFullWidth}
						/>
					</PromptInput>
				</div>
			</div>
		</TooltipProvider>
	);
};
