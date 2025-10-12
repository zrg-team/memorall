import React, { useState, useEffect } from "react";
import { create } from "@ebay/nice-modal-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Search, BookOpen, FileText, Loader2, Check } from "lucide-react";
import { serviceManager } from "@/services";
import type { Topic } from "@/services/database/entities/topics";
import { logError, logInfo } from "@/utils/logger";
import { topicService } from "@/modules/topics/services/topic-service";

export interface TopicSelectorModalProps {
	title?: string;
	description?: string;
	onTopicSelected?: (topic: Topic | null) => void;
	allowCreateNew?: boolean;
	selectedTopicId?: string;
}

interface TopicWithCount extends Topic {
	contentCount?: number;
}

const TopicSelectorModal = create<TopicSelectorModalProps>(
	({
		title,
		description,
		onTopicSelected,
		allowCreateNew = true,
		selectedTopicId,
	}) => {
		const [topics, setTopics] = useState<TopicWithCount[]>([]);
		const [loading, setLoading] = useState(true);
		const [searchTerm, setSearchTerm] = useState("");
		const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
		const [showCreateForm, setShowCreateForm] = useState(false);
		const [newTopicName, setNewTopicName] = useState("");
		const [newTopicDescription, setNewTopicDescription] = useState("");
		const [creating, setCreating] = useState(false);

		// Filter topics based on search term
		const filteredTopics = topics.filter(
			(topic) =>
				topic.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				(topic.description &&
					topic.description.toLowerCase().includes(searchTerm.toLowerCase())),
		);

		useEffect(() => {
			loadTopics();
		}, []);

		useEffect(() => {
			if (selectedTopicId) {
				const topic = topics.find((t) => t.id === selectedTopicId);
				if (topic) {
					setSelectedTopic(topic);
				}
			}
		}, [selectedTopicId, topics]);

		const loadTopics = async () => {
			try {
				setLoading(true);

				const topicsWithCount = await topicService.getTopicsWithContentCount();
				setTopics(topicsWithCount);
				logInfo("[TOPIC_SELECTOR] Loaded topics:", topicsWithCount);
			} catch (error) {
				logError("[TOPIC_SELECTOR] Failed to load topics:", error);
			} finally {
				setLoading(false);
			}
		};

		const handleCreateTopic = async () => {
			if (!newTopicName.trim()) return;

			try {
				setCreating(true);
				const newTopic = await topicService.createTopic({
					name: newTopicName.trim(),
					description: newTopicDescription.trim(),
				});

				// Add to topics list
				setTopics((prev) => [{ ...newTopic, contentCount: 0 }, ...prev]);

				// Select the new topic
				setSelectedTopic(newTopic);

				// Reset form
				setNewTopicName("");
				setNewTopicDescription("");
				setShowCreateForm(false);

				logInfo("[TOPIC_SELECTOR] Created new topic:", newTopic);
			} catch (error) {
				logError("[TOPIC_SELECTOR] Failed to create topic:", error);
			} finally {
				setCreating(false);
			}
		};

		const handleConfirm = () => {
			onTopicSelected?.(selectedTopic);
		};

		const handleCancel = () => {
			onTopicSelected?.(null);
		};

		return (
			<Dialog open onOpenChange={(open) => !open && handleCancel()}>
				<DialogContent className="max-w-2xl max-h-[80vh]">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<BookOpen className="w-5 h-5" />
							{title || "Select Topic"}
						</DialogTitle>
						{description && (
							<p className="text-sm text-muted-foreground">{description}</p>
						)}
					</DialogHeader>

					<div className="space-y-4">
						{/* Search */}
						<div className="relative">
							<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
							<Input
								placeholder="Search topics..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-10"
							/>
						</div>

						{/* Create New Topic Form */}
						{showCreateForm && (
							<div className="border rounded-lg p-4 space-y-3 bg-muted/50">
								<div className="flex items-center justify-between">
									<Label className="text-sm font-medium">
										Create New Topic
									</Label>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setShowCreateForm(false)}
									>
										Cancel
									</Button>
								</div>
								<div className="space-y-3">
									<div>
										<Label htmlFor="topic-name">Topic Name *</Label>
										<Input
											id="topic-name"
											placeholder="Enter topic name..."
											value={newTopicName}
											onChange={(e) => setNewTopicName(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && newTopicName.trim()) {
													handleCreateTopic();
												}
											}}
										/>
									</div>
									<div>
										<Label htmlFor="topic-description">Description</Label>
										<Input
											id="topic-description"
											placeholder="Optional description..."
											value={newTopicDescription}
											onChange={(e) => setNewTopicDescription(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && newTopicName.trim()) {
													handleCreateTopic();
												}
											}}
										/>
									</div>
									<Button
										onClick={handleCreateTopic}
										disabled={!newTopicName.trim() || creating}
										className="w-full"
									>
										{creating ? (
											<>
												<Loader2 className="w-4 h-4 mr-2 animate-spin" />
												Creating...
											</>
										) : (
											<>
												<Plus className="w-4 h-4 mr-2" />
												Create Topic
											</>
										)}
									</Button>
								</div>
							</div>
						)}

						{/* Topics List */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label className="text-sm font-medium">Available Topics</Label>
								{allowCreateNew && !showCreateForm && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => setShowCreateForm(true)}
									>
										<Plus className="w-4 h-4 mr-2" />
										New Topic
									</Button>
								)}
							</div>

							{loading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="w-6 h-6 animate-spin" />
									<span className="ml-2">Loading topics...</span>
								</div>
							) : (
								<ScrollArea className="h-64 border rounded-lg">
									<div className="p-2 space-y-1">
										{filteredTopics.length === 0 ? (
											<div className="text-center py-8 text-muted-foreground">
												{searchTerm ? (
													<div>
														<Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
														<p>No topics found matching "{searchTerm}"</p>
													</div>
												) : (
													<div>
														<BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
														<p>No topics available</p>
														{allowCreateNew && (
															<Button
																variant="link"
																onClick={() => setShowCreateForm(true)}
																className="mt-2"
															>
																Create your first topic
															</Button>
														)}
													</div>
												)}
											</div>
										) : (
											filteredTopics.map((topic) => (
												<div
													key={topic.id}
													className={`p-3 rounded-lg cursor-pointer transition-colors border ${
														selectedTopic?.id === topic.id
															? "bg-primary/10 border-primary"
															: "hover:bg-muted/50 border-transparent"
													}`}
													onClick={() => setSelectedTopic(topic)}
												>
													<div className="flex items-start justify-between">
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2">
																<h4 className="font-medium text-sm truncate">
																	{topic.name}
																</h4>
																{selectedTopic?.id === topic.id && (
																	<Check className="w-4 h-4 text-primary flex-shrink-0" />
																)}
															</div>
															{topic.description && (
																<p className="text-xs text-muted-foreground mt-1 line-clamp-2">
																	{topic.description}
																</p>
															)}
															<div className="flex items-center gap-2 mt-2">
																<Badge variant="secondary" className="text-xs">
																	<FileText className="w-3 h-3 mr-1" />
																	{topic.contentCount || 0} content
																	{(topic.contentCount || 0) !== 1 ? "s" : ""}
																</Badge>
																<span className="text-xs text-muted-foreground">
																	{new Date(
																		topic.createdAt,
																	).toLocaleDateString()}
																</span>
															</div>
														</div>
													</div>
												</div>
											))
										)}
									</div>
								</ScrollArea>
							)}
						</div>

						{/* Selected Topic Info */}
						{selectedTopic && (
							<div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
								<div className="flex items-center gap-2 mb-1">
									<Check className="w-4 h-4 text-primary" />
									<span className="font-medium text-sm">Selected Topic</span>
								</div>
								<p className="text-sm font-medium">{selectedTopic.name}</p>
								{selectedTopic.description && (
									<p className="text-xs text-muted-foreground mt-1">
										{selectedTopic.description}
									</p>
								)}
							</div>
						)}
					</div>

					<Separator />

					<DialogFooter>
						<Button variant="outline" onClick={handleCancel}>
							Cancel
						</Button>
						<Button onClick={handleConfirm} disabled={!selectedTopic}>
							{selectedTopic
								? `Select "${selectedTopic.name}"`
								: "Select Topic"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	},
);

export default TopicSelectorModal;
