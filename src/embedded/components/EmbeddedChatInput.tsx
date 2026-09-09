import type React from "react";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { EmbeddedContextItem } from "@/embedded/types";
import { EmbeddedComposerContext } from "./EmbeddedComposerContext";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "./MessageControl";

interface EmbeddedChatInputProps {
	inputValue: string;
	setInputValue: (value: string) => void;
	onSubmit: React.FormEventHandler<HTMLFormElement>;
	isTyping: boolean;
	modelAvailable: boolean;
	selectedAgentFlowId: string;
	setSelectedAgentFlowId: (flowId: string) => void;
	agentFlows: Array<{ id: string; name: string }>;
	selectedTopic: string;
	setSelectedTopic: (topicId: string) => void;
	topics: Array<{ id: string; name: string }>;
	topicsLoading: boolean;
	hasTopics: boolean;
	messages: any[];
	attachedContexts: EmbeddedContextItem[];
	onRemoveAttachedContext: (contextItemId: string) => void;
	onDeleteChat: () => void;
	onStop: () => void;
	onOpenSettings: () => void;
}

export const EmbeddedChatInput: React.FC<EmbeddedChatInputProps> = ({
	inputValue,
	setInputValue,
	onSubmit,
	isTyping,
	modelAvailable,
	selectedAgentFlowId,
	setSelectedAgentFlowId,
	agentFlows,
	selectedTopic,
	setSelectedTopic,
	topics,
	topicsLoading,
	hasTopics,
	messages,
	attachedContexts,
	onRemoveAttachedContext,
	onDeleteChat,
	onStop,
	onOpenSettings,
}) => {
	const tChat = useEmbeddedTranslation("chat");
	const tInput = useEmbeddedTranslation("input");
	const tMessageControl = useEmbeddedTranslation("messageControl");
	const isCustomMode = selectedAgentFlowId !== "chat";
	const flowOptions = [
		{ id: "chat", name: tInput("modeGeneral") },
		...agentFlows,
	];

	return (
		<div className="memorall-composer">
			<EmbeddedComposerContext
				attachedContexts={attachedContexts}
				onRemoveAttachedContext={onRemoveAttachedContext}
			/>
			<PromptInput onSubmit={onSubmit}>
				<PromptInputTextarea
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					placeholder={
						!modelAvailable ? tInput("noModelAvailable") : tInput("typeMessage")
					}
					disabled={isTyping || !modelAvailable}
				/>
				<PromptInputToolbar>
					<div className="memorall-composer-row">
						{/* Scrollable tools container */}
						<div className="memorall-composer-scroll">
							<PromptInputTools>
								<div className="memorall-select-wrap">
									<select
										value={selectedAgentFlowId}
										onChange={(e) => setSelectedAgentFlowId(e.target.value)}
										disabled={isTyping}
										className="memorall-select"
										onKeyDown={(e) => e.stopPropagation()}
										onKeyUp={(e) => e.stopPropagation()}
										onKeyPress={(e) => e.stopPropagation()}
									>
										{flowOptions.map((flow) => (
											<option key={flow.id} value={flow.id}>
												{flow.name}
											</option>
										))}
									</select>
								</div>

								{/* Topic Selector - Only show when in custom mode */}
								{isCustomMode && (
									<div className="memorall-select-wrap">
										<select
											value={selectedTopic}
											onChange={(e) => setSelectedTopic(e.target.value)}
											disabled={topicsLoading}
											className="memorall-select"
											onKeyDown={(e) => e.stopPropagation()}
											onKeyUp={(e) => e.stopPropagation()}
											onKeyPress={(e) => e.stopPropagation()}
										>
											{topicsLoading ? (
												<option value="">{tInput("loadingTopics")}</option>
											) : (
												<>
													<option value="">{tChat("defaultTopic")}</option>
													{topics.map((topic) => (
														<option key={topic.id} value={topic.id}>
															{topic.name}
														</option>
													))}
												</>
											)}
										</select>
									</div>
								)}

								{isCustomMode && (
									<button
										type="button"
										onClick={onOpenSettings}
										className="memorall-icon-button memorall-icon-button--compact"
										onKeyDown={(e) => e.stopPropagation()}
										onKeyUp={(e) => e.stopPropagation()}
										onKeyPress={(e) => e.stopPropagation()}
										title={tMessageControl("openFullVersion")}
									>
										<svg
											className="w-4 h-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
											/>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
											/>
										</svg>
									</button>
								)}
							</PromptInputTools>
						</div>
						{/* Actions and Submit button */}
						<div className="memorall-composer-actions">
							{/* Clear Chat Button */}
							{messages.length > 0 && (
								<button
									onClick={onDeleteChat}
									className="memorall-icon-button memorall-icon-button--danger memorall-icon-button--compact"
									onKeyDown={(e) => e.stopPropagation()}
									onKeyUp={(e) => e.stopPropagation()}
									onKeyPress={(e) => e.stopPropagation()}
									title={tInput("clearChat")}
								>
									<svg
										className="w-4 h-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							)}
							<PromptInputSubmit
								disabled={
									isTyping ? false : !inputValue.trim() || !modelAvailable
								}
								status={isTyping ? "streaming" : "ready"}
								onStop={onStop}
							/>
						</div>
					</div>
				</PromptInputToolbar>
			</PromptInput>
		</div>
	);
};

export default EmbeddedChatInput;
