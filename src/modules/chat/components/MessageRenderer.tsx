import React, { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Message, MessageContent } from "@/components/ui/shadcn-io/ai/message";
import {
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/components/ui/shadcn-io/ai/task";
import { MarkdownMessage } from "@/modules/chat/components/MarkdownMessage";
import { MermaidRenderer } from "@/components/atoms/MermaidRenderer";
import type { Message as DBMessage } from "@/services/database";
import dayjs from "dayjs";

// Direct Mermaid component for task descriptions - only renders when visible
const TaskMermaidDiagram: React.FC<{ chart: string; isOpen: boolean }> = ({
	chart,
	isOpen,
}) => {
	const hasRendered = useRef(false);

	// Only render once when opened
	if (!isOpen) {
		return null;
	}

	if (!hasRendered.current) {
		hasRendered.current = true;
	}

	return <MermaidRenderer chart={chart} />;
};

// Helper function to detect if content is only a mermaid code block
const isMermaidOnly = (content: string): boolean => {
	const trimmed = content.trim();
	const mermaidRegex = /^```mermaid\s*\n([\s\S]*?)\n```$/;
	const result = mermaidRegex.test(trimmed);
	return result;
};

// Helper function to extract mermaid content from code block
const extractMermaidContent = (content: string): string => {
	const trimmed = content.trim();
	const mermaidRegex = /^```mermaid\s*\n([\s\S]*?)\n```$/;
	const match = trimmed.match(mermaidRegex);
	const extracted = match ? match[1].trim() : "";
	return extracted;
};

// Type definitions
interface ActionItem {
	name: string;
	description: string;
	metadata?: Record<string, unknown>;
}

// TaskItemRenderer component to properly manage state per task
interface TaskItemRendererProps {
	item: ActionItem;
	index: number;
}

const TaskItemRenderer: React.FC<TaskItemRendererProps> = React.memo(
	({ item, index }) => {
		const [isOpen, setIsOpen] = React.useState(false);

		const trimmedDesc = item.description ? item.description.trim() : "";
		const isMermaid = isMermaidOnly(trimmedDesc);

		return (
			<Task
				key={`${item.name}_${index}`}
				className="w-full"
				defaultOpen={false}
				onOpenChange={setIsOpen}
			>
				<TaskTrigger title={item.name} />
				<TaskContent>
					<TaskItem>
						{isOpen ? (
							isMermaid ? (
								<TaskMermaidDiagram
									chart={extractMermaidContent(item.description)}
									isOpen={isOpen}
								/>
							) : (
								<div className="w-full overflow-hidden whitespace-pre-wrap break-words">
									{item.description}
								</div>
							)
						) : undefined}
					</TaskItem>
				</TaskContent>
			</Task>
		);
	},
);

interface MessageRendererProps {
	message: DBMessage;
	index: number;
	isLastMessage: boolean;
	isLoading: boolean;
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
	message,
	index,
	isLastMessage,
	isLoading,
}) => {
	// Check if this is a separator message
	if (message.type === "separator") {
		return (
			<div key={message.id} className="my-8 flex items-center">
				<div className="flex-1 border-t border-gray-300"></div>
				<div className="mx-4 text-xs text-gray-500 font-medium">
					{dayjs(message.createdAt).format("MMM D, YYYY h:mm A")}
				</div>
				<div className="flex-1 border-t border-gray-300"></div>
			</div>
		);
	}

	const actions: ActionItem[] =
		message.metadata &&
		typeof message.metadata === "object" &&
		"actions" in message.metadata &&
		message.metadata?.actions &&
		Array.isArray(message.metadata.actions)
			? message.metadata.actions
			: [];

	if (
		!message.content &&
		isLastMessage &&
		isLoading &&
		message.role === "assistant"
	) {
		return (
			<div key={message.id} className="flex flex-col gap-4">
				{actions.length > 0 &&
					actions.map((item, index) => (
						<TaskItemRenderer
							key={`${item.name}_${index}`}
							item={item}
							index={index}
						/>
					))}
				<Message from="assistant">
					<MessageContent>
						<Loader2 className="w-4 h-4 animate-spin" />
					</MessageContent>
				</Message>
			</div>
		);
	}

	return (
		<div key={message.id} className="flex flex-col gap-4">
			{actions.length > 0 &&
				actions.map((item, index) => (
					<TaskItemRenderer
						key={`${item.name}_${index}`}
						item={item}
						index={index}
					/>
				))}
			<Message key={message.id} from={message.role}>
				<MessageContent>
					<MarkdownMessage
						content={message.content}
						isStreaming={
							isLastMessage && isLoading && message.role === "assistant"
						}
					/>
				</MessageContent>
			</Message>
		</div>
	);
};
