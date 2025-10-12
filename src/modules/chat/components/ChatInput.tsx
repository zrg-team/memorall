import React, { useState, useEffect } from "react";
import {
	PaperclipIcon,
	MicIcon,
	Square,
	Minus,
	Bot,
	Brain,
	MessageCircle,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ChatStatus } from "ai";
import type { ChatMode } from "./hooks/use-chat";
import { topicService } from "@/modules/topics/services/topic-service";

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
}) => {
	const [topics, setTopics] = useState<Array<{ id: string; name: string }>>([]);
	const [isLoadingTopics, setIsLoadingTopics] = useState(false);

	// Fetch topics when knowledge mode is selected
	useEffect(() => {
		if (chatMode === "knowledge") {
			const fetchTopics = async () => {
				try {
					setIsLoadingTopics(true);
					const result = await topicService.getTopics();
					setTopics(
						result.map((topic) => ({
							id: topic.id,
							name: topic.name,
						})),
					);
				} catch (error) {
					console.error("Failed to fetch topics:", error);
					setTopics([]);
				} finally {
					setIsLoadingTopics(false);
				}
			};

			fetchTopics();
		}
	}, [chatMode]);

	const getModeIcon = (mode: ChatMode) => {
		switch (mode) {
			case "normal":
				return <MessageCircle size={14} />;
			case "agent":
				return <Bot size={14} />;
			case "knowledge":
				return <Brain size={14} />;
		}
	};

	const getModeLabel = (mode: ChatMode) => {
		switch (mode) {
			case "normal":
				return "Chat";
			case "agent":
				return "Agent";
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
						<PromptInputTools>
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
										className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
									>
										{getModeIcon(chatMode)}
										<span>{getModeLabel(chatMode)}</span>
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
										onClick={() => setChatMode("agent")}
										className="flex items-center gap-2"
									>
										<Bot size={14} />
										<span>Agent Mode</span>
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
								<Select
									value={selectedTopic}
									onValueChange={setSelectedTopic}
									disabled={isLoadingTopics}
								>
									<SelectTrigger className="w-32 h-8">
										<SelectValue
											placeholder={isLoadingTopics ? "..." : "All"}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="__all__">All topics</SelectItem>
										{topics.map((topic) => (
											<SelectItem key={topic.id} value={topic.id}>
												{topic.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</PromptInputTools>
						<div className="flex items-center gap-2">
							<PromptInputButton>
								<PaperclipIcon size={16} />
							</PromptInputButton>
							<PromptInputButton>
								<MicIcon size={16} />
							</PromptInputButton>
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
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
};
