"use client";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ui/shadcn-io/ai/conversation";
import {
	LoadingScreen,
	NoModelsScreen,
	MessageRenderer,
	ChatInput,
	useCurrentModel,
	useChat,
} from "@/modules/chat/components";
import { topicService } from "@/modules/topics/services/topic-service";

export const ChatPage: React.FC = () => {
	const navigate = useNavigate();
	const { model, isInitialized, handleModelLoaded } = useCurrentModel();
	const [topics, setTopics] = useState<Array<{ id: string; name: string }>>([]);
	const [isLoadingTopics, setIsLoadingTopics] = useState(false);
	const {
		inputValue,
		setInputValue,
		status,
		chatMode,
		setChatMode,
		selectedTopic,
		setSelectedTopic,
		messages,
		isLoading,
		abortController,
		handleSubmit,
		handleStop,
		insertSeparator,
		deleteMessages,
	} = useChat(model);

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

	// Navigate to models tab
	const navigateToModels = () => {
		navigate("/llm");
	};

	if (!isInitialized) {
		return <LoadingScreen />;
	}

	// Show YourModels component if no loaded models available
	if (!model) {
		return (
			<NoModelsScreen
				onModelLoaded={handleModelLoaded}
				onNavigateToModels={navigateToModels}
			/>
		);
	}

	return (
		<div className="flex flex-col h-full bg-background">
			<Conversation className="flex-1 min-h-0">
				<ConversationContent className="max-w-3xl mx-auto space-y-4">
					{messages.map((message, index) => {
						const isLastMessage = index === messages.length - 1;
						return (
							<MessageRenderer
								key={message.id}
								message={message}
								index={index}
								isLastMessage={isLastMessage}
								isLoading={isLoading}
							/>
						);
					})}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<ChatInput
				inputValue={inputValue}
				setInputValue={setInputValue}
				onSubmit={handleSubmit}
				isLoading={isLoading}
				model={model}
				status={status}
				chatMode={chatMode}
				setChatMode={setChatMode}
				selectedTopic={selectedTopic}
				setSelectedTopic={setSelectedTopic}
				onInsertSeparator={insertSeparator}
				onStop={handleStop}
				onDeleteChat={deleteMessages}
				abortController={abortController}
				isLoadingTopics={isLoadingTopics}
				topics={topics}
			/>
		</div>
	);
};
