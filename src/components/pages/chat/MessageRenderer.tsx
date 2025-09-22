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
import dayjs from "dayjs";
import mermaid from "mermaid";

// Initialize mermaid with browser extension compatible settings
console.log("Initializing mermaid library...");
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

// Direct Mermaid component for task descriptions
const TaskMermaidDiagram: React.FC<{ chart: string }> = ({ chart }) => {
	const [renderState, setRenderState] = React.useState<
		"loading" | "success" | "error"
	>("loading");
	const [uniqueId] = React.useState(
		() => `task-mermaid-${++mermaidCounter}-${Date.now()}`,
	);
	const [svgContent, setSvgContent] = React.useState<string>("");

	console.log("TaskMermaidDiagram", chart);

	useEffect(() => {
		let isMounted = true;
		let timeoutId: NodeJS.Timeout;

		const renderChart = async () => {
			const trimmedChart = chart.trim();

			console.log("renderChart called:", {
				trimmedChart,
				isMounted,
				uniqueId,
			});

			if (!trimmedChart) {
				console.log("No chart content, setting error state");
				setRenderState("error");
				return;
			}

			if (!isMounted) {
				console.log("Component unmounted, aborting render");
				return;
			}

			try {
				// Add timeout to prevent infinite loading
				timeoutId = setTimeout(() => {
					if (isMounted) {
						console.log("Timeout reached, setting error state");
						setRenderState("error");
					}
				}, 5000);

				console.log("Parsing chart:", trimmedChart);
				// Try to parse first to catch syntax errors
				await mermaid.parse(trimmedChart);

				if (!isMounted) return;

				console.log("Rendering chart with mermaid.render");
				// Render the diagram
				const { svg } = await mermaid.render(uniqueId, trimmedChart);

				if (!isMounted) return;

				clearTimeout(timeoutId);

				console.log("Mermaid render result:", {
					hasSvg: !!svg,
					svgLength: svg?.length,
					containsSvgTag: svg?.includes("<svg"),
					containsError: svg?.includes("Syntax error"),
				});

				if (svg && svg.includes("<svg") && !svg.includes("Syntax error")) {
					setSvgContent(svg);
					setRenderState("success");
				} else {
					console.log("Invalid SVG result");
					setRenderState("error");
				}
			} catch (error) {
				console.error("Mermaid rendering error:", error);
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
	}, [chart, uniqueId]);

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

interface MessageData {
	id: string;
	role: string;
	content: string;
	type?: string;
	createdAt: Date;
	metadata?: any;
}

interface MessageRendererProps {
	message: MessageData;
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

	const actions =
		message.metadata &&
		typeof message.metadata === "object" &&
		"actions" in message.metadata &&
		Array.isArray(message.metadata?.actions) &&
		message.metadata.actions.length > 0
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
				{actions?.length
					? actions.map((item: any, index: number) => {
							return (
								<Task
									key={`${item.name}_${index}`}
									className="w-full"
									defaultOpen={false}
								>
									<TaskTrigger title={item.name} />
									<TaskContent>
										<TaskItem>
											{(() => {
												const trimmedDesc = item.description
													? item.description.trim()
													: "";
												const isMermaid = isMermaidOnly(trimmedDesc);
												if (isMermaid) {
													const chart = extractMermaidContent(item.description);
													return <TaskMermaidDiagram chart={chart} />;
												}
												return item.description;
											})()}
										</TaskItem>
									</TaskContent>
								</Task>
							);
						})
					: undefined}
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
			{actions?.length
				? actions.map((item: any, index: number) => {
						return (
							<Task
								key={`${item.name}_${index}`}
								className="w-full"
								defaultOpen={false}
							>
								<TaskTrigger title={item.name} />
								<TaskContent>
									<TaskItem>
										{(() => {
											const trimmedDesc = item.description
												? item.description.trim()
												: "";
											const isMermaid = isMermaidOnly(trimmedDesc);
											if (isMermaid) {
												const chart = extractMermaidContent(item.description);
												return <TaskMermaidDiagram chart={chart} />;
											}
											return item.description;
										})()}
									</TaskItem>
								</TaskContent>
							</Task>
						);
					})
				: undefined}
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
