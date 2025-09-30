import React from "react";
import type { ChatMessage } from "../types";
import { EmbeddedMarkdown } from "./EmbeddedMarkdown";
import { Task, TaskTrigger, TaskContent, TaskItem } from "./TaskComponents";
import { Loader } from "./Icons";

export interface EmbeddedMessageRendererProps {
	message: ChatMessage;
	isLoading: boolean;
}

// Enhanced Message Renderer with Actions
export const EmbeddedMessageRenderer: React.FC<
	EmbeddedMessageRendererProps
> = ({ message, isLoading }) => {
	const actions = message.metadata?.actions || [];

	// Loading state with actions
	if (!message.content && isLoading && message.role === "assistant") {
		return (
			<div className="flex flex-col gap-4">
				{actions.length > 0 &&
					actions.map((action, index) => (
						<Task
							key={`${action.name}_${index}`}
							className="w-full"
							defaultOpen={false}
						>
							<TaskTrigger title={action.name} />
							<TaskContent>
								<TaskItem>{action.description}</TaskItem>
							</TaskContent>
						</Task>
					))}
				<div className="flex items-center gap-2">
					<Loader size={14} />
					<span className="text-muted-foreground text-sm">Thinking...</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{actions.length > 0 &&
				actions.map((action, index) => (
					<Task
						key={`${action.name}_${index}`}
						className="w-full"
						defaultOpen={false}
					>
						<TaskTrigger title={action.name} />
						<TaskContent>
							<TaskItem>{action.description}</TaskItem>
						</TaskContent>
					</Task>
				))}
			{message.content && (
				<EmbeddedMarkdown
					content={message.content}
					isStreaming={isLoading && message.role === "assistant"}
				/>
			)}
		</div>
	);
};
