import React, { useState, useEffect } from "react";
import {
	Square,
	Minus,
	Bot,
	Brain,
	MessageCircle,
	ChevronDown,
	Tags,
	Trash2,
} from "lucide-react";
import {
	PromptInput,
	PromptInputButton,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@/components/ui/shadcn-io/ai/prompt-input";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatStatus } from "ai";
import type { ChatMode } from "../hooks/use-chat";

interface ChatInputProps {
	inputValue: string;
	setInputValue: (value: string) => void;
	onSubmit: (e: React.FormEvent) => void;
	isLoading: boolean;
	model: string;
	status: ChatStatus;
	chatMode: ChatMode;
	setChatMode: (mode: ChatMode) => void;
	selectedTopic: string;
	setSelectedTopic: (topicId: string) => void;
	onInsertSeparator: () => void;
	onStop: () => void;
	abortController: AbortController | null;
	isLoadingTopics: boolean;
	topics: Array<{ id: string; name: string }>;
	onDeleteChat: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
	inputValue,
	setInputValue,
	onSubmit,
	isLoading,
	model,
	status,
	chatMode,
	setChatMode,
	selectedTopic,
	setSelectedTopic,
	onInsertSeparator,
	onStop,
	abortController,
	isLoadingTopics,
	onDeleteChat,
	topics,
}) => {
	const getModeIcon = (mode: ChatMode) => {
		switch (mode) {
			case "normal":
				return <MessageCircle size={14} />;
			case "knowledge":
				return <Brain size={14} />;
		}
	};

	const getModeLabel = (mode: ChatMode) => {
		switch (mode) {
			case "normal":
				return "Chat";
			case "knowledge":
				return "Knowledge";
		}
	};
	return (
		<div className="px-4 py-2 w-full flex-shrink-0">
			<div className="max-w-3xl mx-auto">
				<PromptInput onSubmit={onSubmit}>
					<PromptInputTextarea
						value={inputValue}
						onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
							setInputValue(e.target.value)
						}
						placeholder="Type your message..."
						disabled={isLoading}
					/>
					<PromptInputToolbar>
						<div className="flex items-center gap-2 min-w-0 flex-1">
							{/* Scrollable tools container */}
							<div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
								<PromptInputTools>
									<PromptInputButton
										onClick={onDeleteChat}
										disabled={isLoading}
										title="Delete"
									>
										<Trash2 size={16} />
									</PromptInputButton>
									<PromptInputButton
										onClick={onInsertSeparator}
										disabled={isLoading}
										title="Add separator"
									>
										<Minus size={16} />
										<span>Clear</span>
									</PromptInputButton>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												disabled={isLoading}
												className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
											>
												{getModeIcon(chatMode)}
												<span>{getModeLabel(chatMode)}</span>
												<ChevronDown size={12} className="opacity-50" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start">
											<DropdownMenuItem
												onClick={() => setChatMode("normal")}
												className="flex items-center gap-2"
											>
												<MessageCircle size={14} />
												<span>Normal Chat</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => setChatMode("knowledge")}
												className="flex items-center gap-2"
											>
												<Brain size={14} />
												<span>Knowledge Mode</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
									{/* Topic Selector - inline with mode selector */}
									{chatMode === "knowledge" && (
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													disabled={isLoadingTopics}
													className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
												>
													<Tags size={14} />
													<span>
														{isLoadingTopics
															? "Loading..."
															: selectedTopic === "__all__"
																? "All Topics"
																: topics.find((t) => t.id === selectedTopic)
																		?.name || "Select Topic"}
													</span>
													<ChevronDown size={12} className="opacity-50" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="start">
												<DropdownMenuItem
													onClick={() => setSelectedTopic("__all__")}
													className="flex items-center gap-2"
												>
													<Tags size={14} />
													<span>All Topics</span>
												</DropdownMenuItem>
												{topics.map((topic) => (
													<DropdownMenuItem
														key={topic.id}
														onClick={() => setSelectedTopic(topic.id)}
														className="flex items-center gap-2"
													>
														<Tags size={14} />
														<span>{topic.name}</span>
													</DropdownMenuItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									)}
								</PromptInputTools>
							</div>
							{/* Sticky send button */}
							<div className="flex items-center gap-2 flex-shrink-0">
								{isLoading && abortController ? (
									<Button
										type="button"
										onClick={onStop}
										size="sm"
										variant="outline"
										className="border-red-200 text-red-600 hover:bg-red-50"
									>
										<Square size={16} />
									</Button>
								) : (
									<PromptInputSubmit
										disabled={!inputValue.trim() || isLoading || !model}
										status={status}
									/>
								)}
							</div>
						</div>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
};
