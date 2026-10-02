import React from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Brain, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/main/components/ui/shadcn-io/ai/task";
import {
	ASSISTANT_DISCLOSURE_ICON_CLASS,
	ASSISTANT_DISCLOSURE_TRIGGER_CLASS,
} from "./assistant-disclosure";
import { rehypePlugins, remarkPlugins } from "./markdownComponents";

interface ThinkingSectionsProps {
	thinking: string[];
	hasIncompleteThinking: boolean;
	isStreaming: boolean;
	components: any;
}

export const ThinkingSections: React.FC<ThinkingSectionsProps> = ({
	thinking,
	hasIncompleteThinking,
	isStreaming,
	components,
}) => {
	const { t } = useTranslation("chat");

	if (thinking.length === 0) return null;

	return (
		<div className="mb-4 space-y-2">
			{thinking.map((thinkContent, index) => {
				const isIncomplete = hasIncompleteThinking && index === 0;
				const isThinking = isStreaming && isIncomplete;

				return (
					<Task key={index} defaultOpen={isIncomplete}>
						<TaskTrigger
							title={
								isThinking ? t("messages.thinking") : t("messages.thought")
							}
						>
							<button
								type="button"
								className={ASSISTANT_DISCLOSURE_TRIGGER_CLASS}
							>
								<Brain
									className={cn(
										ASSISTANT_DISCLOSURE_ICON_CLASS,
										isThinking && "animate-pulse text-primary",
									)}
								/>
								<span className="truncate">
									{isThinking ? t("messages.thinking") : t("messages.thought")}
								</span>
								<ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
							</button>
						</TaskTrigger>
						<TaskContent>
							<TaskItem>
								<ReactMarkdown
									remarkPlugins={remarkPlugins}
									rehypePlugins={rehypePlugins}
									components={components}
								>
									{thinkContent}
								</ReactMarkdown>
							</TaskItem>
						</TaskContent>
					</Task>
				);
			})}
		</div>
	);
};
