import React, { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Message, MessageContent } from "@/components/ui/shadcn-io/ai/message";
import {
	Task,
	TaskContent,
	TaskItem,
	TaskTrigger,
} from "@/components/ui/shadcn-io/ai/task";
import { MarkdownMessage } from "@/components/pages/chat/MarkdownMessage";
import type { Message as DBMessage } from "@/services/database";
import dayjs from "dayjs";
import mermaid from "mermaid";

// Initialize mermaid with browser extension compatible settings
mermaid.initialize({
	startOnLoad: false,
	theme: "default",
	securityLevel: "loose", // Important for browser extensions
	flowchart: {
		useMaxWidth: true,
		htmlLabels: true,
	},
	// Disable workers which can cause issues in browser extensions
	suppressErrorRendering: false,
	logLevel: "debug", // Enable debug logging
});

// Global counter for unique mermaid IDs
let mermaidCounter = 0;

// Direct Mermaid component for task descriptions - only renders when visible
const TaskMermaidDiagram: React.FC<{ chart: string; isOpen: boolean }> = ({
	chart,
	isOpen,
}) => {
	const [renderState, setRenderState] = React.useState<
		"idle" | "loading" | "success" | "error"
	>("idle");
	const [uniqueId] = React.useState(
		() => `task-mermaid-${++mermaidCounter}-${Date.now()}`,
	);
	const [svgContent, setSvgContent] = React.useState<string>("");
	const hasRendered = useRef(false);

	useEffect(() => {
		// Only render when open and hasn't been rendered yet
		if (!isOpen || hasRendered.current) {
			return;
		}

		let isMounted = true;
		let timeoutId: NodeJS.Timeout;

		const renderChart = async () => {
			const trimmedChart = chart.trim();
			if (!trimmedChart) {
				setRenderState("error");
				return;
			}

			if (!isMounted) {
				return;
			}

			setRenderState("loading");

			try {
				// Add timeout to prevent infinite loading
				timeoutId = setTimeout(() => {
					if (isMounted) {
						setRenderState("error");
					}
				}, 5000);

				// Try to parse first to catch syntax errors
				await mermaid.parse(trimmedChart);

				if (!isMounted) return;

				// Render the diagram
				const { svg } = await mermaid.render(uniqueId, trimmedChart);

				if (!isMounted) return;

				clearTimeout(timeoutId);

				if (svg && svg.includes("<svg") && !svg.includes("Syntax error")) {
					setSvgContent(svg);
					setRenderState("success");
					hasRendered.current = true;
				} else {
					setRenderState("error");
				}
			} catch (error) {
				if (!isMounted) return;
				clearTimeout(timeoutId);
				setRenderState("error");
			}
		};

		renderChart();

		return () => {
			isMounted = false;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [chart, uniqueId, isOpen]);

	if (renderState === "idle") {
		return null;
	}

	if (renderState === "error") {
		return (
			<div className="text-sm text-muted-foreground">
				Failed to render diagram
			</div>
		);
	}

	if (renderState === "loading") {
		return (
			<div className="text-sm text-muted-foreground">Loading diagram...</div>
		);
	}

	return (
		<div className="my-2" dangerouslySetInnerHTML={{ __html: svgContent }} />
	);
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
