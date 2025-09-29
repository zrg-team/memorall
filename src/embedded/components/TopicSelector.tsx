import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";
import { BookOpen, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TopicSelectorProps } from "../types";
import { getTopicsForSelector, sendContentWithTopic } from "../messaging";

interface Topic {
	id: string;
	name: string;
	description?: string;
}

const TopicSelector: React.FC<TopicSelectorProps> = ({
	context,
	pageUrl,
	pageTitle,
	onClose,
}) => {
	const [topics, setTopics] = useState<Topic[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		loadTopics();
	}, []);

	const loadTopics = async () => {
		try {
			setLoading(true);
			const loadedTopics = await getTopicsForSelector();
			setTopics(loadedTopics);
		} catch (error) {
			console.error("Failed to load topics:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleTopicSelect = async (topic: Topic) => {
		if (saving) return;

		setSelectedTopic(topic);
		setSaving(true);

		try {
			await sendContentWithTopic(context, pageUrl, pageTitle, topic.id);

			// Show success message briefly
			setTimeout(() => {
				onClose();
			}, 1500);
		} catch (error) {
			console.error("Failed to save content with topic:", error);
			setSaving(false);
			// Reset selection on error
			setSelectedTopic(null);
		}
	};

	// Calculate position near mouse cursor but ensure it stays within viewport
	const getPositionStyle = () => {
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const selectorWidth = 280;
		const selectorHeight = 350;

		// Use center if mouse position is not available
		let x = Math.max(50, (viewportWidth - selectorWidth) / 2);
		let y = Math.max(50, (viewportHeight - selectorHeight) / 2);

		return {
			position: "fixed" as const,
			left: `${x}px`,
			top: `${y}px`,
			width: `${selectorWidth}px`,
			maxHeight: `${selectorHeight}px`,
		};
	};

	if (saving && selectedTopic) {
		return (
			<div
				className="fixed inset-0 z-[999999] bg-black/50 flex items-center justify-center"
				onClick={(e) => {
					if (e.target === e.currentTarget) {
						onClose();
					}
				}}
			>
				<div
					style={getPositionStyle()}
					className="bg-background border border-border rounded-lg shadow-xl p-6 flex flex-col items-center gap-3"
				>
					<div className="text-green-600">
						<Check className="w-8 h-8" />
					</div>
					<div className="text-center">
						<h3 className="font-semibold text-sm">Saved to Topic</h3>
						<p className="text-xs text-muted-foreground mt-1">
							Content saved to "{selectedTopic.name}"
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="fixed inset-0 z-[999999] bg-black/50 flex items-center justify-center"
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					onClose();
				}
			}}
		>
			<div
				style={getPositionStyle()}
				className="bg-background border border-border rounded-lg shadow-xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b bg-muted/50">
					<div className="flex items-center gap-2">
						<BookOpen className="w-4 h-4" />
						<span className="font-medium text-sm">Select Topic</span>
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={onClose}
						className="h-6 w-6 p-0"
					>
						<X className="size-3" />
					</Button>
				</div>

				{/* Content */}
				<div className="p-4">
					{context && (
						<div className="mb-3 p-2 bg-muted/50 rounded text-xs">
							<span className="font-medium">Context:</span>{" "}
							{context.substring(0, 100)}
							{context.length > 100 && "..."}
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center py-8">
							<Loader size={16} />
							<span className="ml-2 text-sm">Loading topics...</span>
						</div>
					) : topics.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
							<p className="text-sm">No topics available</p>
						</div>
					) : (
						<ScrollArea className="max-h-48">
							<div className="space-y-1">
								{topics.map((topic) => (
									<div
										key={topic.id}
										className={cn(
											"p-3 rounded-lg cursor-pointer transition-colors border hover:bg-muted/50",
											selectedTopic?.id === topic.id &&
												"bg-primary/10 border-primary",
										)}
										onClick={() => handleTopicSelect(topic)}
									>
										<div className="flex items-start justify-between">
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<h4 className="font-medium text-sm truncate">
														{topic.name}
													</h4>
													{selectedTopic?.id === topic.id && saving && (
														<Loader size={12} />
													)}
												</div>
												{topic.description && (
													<p className="text-xs text-muted-foreground mt-1 line-clamp-2">
														{topic.description}
													</p>
												)}
											</div>
										</div>
									</div>
								))}
							</div>
						</ScrollArea>
					)}
				</div>

				{/* Footer */}
				<div className="border-t p-3 bg-muted/30">
					<p className="text-xs text-muted-foreground">
						Select a topic to save this content
					</p>
				</div>
			</div>
		</div>
	);
};

// Function to create and mount the topic selector
export function createEmbeddedTopicSelector(
	props: TopicSelectorProps,
): () => void {
	// Create container element
	const container = document.createElement("div");
	container.id = "memorall-embedded-topic-selector";

	// Add classes for proper styling
	container.className = "memorall-topic-selector-container";

	// Inject basic styles instead of full Tailwind
	if (!document.querySelector("#memorall-embedded-styles")) {
		const style = document.createElement("style");
		style.id = "memorall-embedded-styles";
		style.textContent = `
			.memorall-topic-selector-container * {
				box-sizing: border-box;
			}
			.memorall-topic-selector-container {
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
			}
		`;
		document.head.appendChild(style);
	}

	// Create root and render
	const root = createRoot(container);

	const cleanupModal = () => {
		root.unmount();
		container.remove();
	};

	const selectorProps = {
		...props,
		onClose: () => {
			props.onClose();
			cleanupModal();
		},
	};

	root.render(<TopicSelector {...selectorProps} />);

	// Append to body
	document.body.appendChild(container);

	// Auto-remove after 30 seconds if no selection
	const autoRemoveTimer = setTimeout(() => {
		cleanupModal();
	}, 30000);

	// Return cleanup function
	return () => {
		clearTimeout(autoRemoveTimer);
		cleanupModal();
	};
}

export default TopicSelector;
