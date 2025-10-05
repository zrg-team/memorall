import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Plus,
	Search,
	FileText,
	MoreVertical,
	Edit2,
	Trash2,
	Loader2,
	Tags,
} from "lucide-react";
import { serviceManager } from "@/services";
import type { Topic } from "@/services/database/entities/topics";
import { logError, logInfo } from "@/utils/logger";

interface TopicWithCount extends Topic {
	contentCount?: number;
}

export const TopicsPage: React.FC = () => {
	const [topics, setTopics] = useState<TopicWithCount[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState("");

	// Create topic dialog
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
	const [newTopicName, setNewTopicName] = useState("");
	const [newTopicDescription, setNewTopicDescription] = useState("");

	// Edit topic dialog
	const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editLoading, setEditLoading] = useState(false);

	// Filter topics
	const filteredTopics = React.useMemo(() => {
		return topics.filter(
			(topic) =>
				topic.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				(topic.description &&
					topic.description.toLowerCase().includes(searchTerm.toLowerCase())),
		);
	}, [topics, searchTerm]);

	useEffect(() => {
		loadTopics();
	}, []);

	const loadTopics = async () => {
		try {
			setLoading(true);
			const topicService = serviceManager.getService("topic");
			if (!topicService) {
				throw new Error("Topic service not available");
			}

			const topicsWithCount = await topicService.getTopicsWithContentCount();
			setTopics(topicsWithCount);
			logInfo("[TOPICS_PAGE] Loaded topics:", topicsWithCount);
		} catch (error) {
			logError("[TOPICS_PAGE] Failed to load topics:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleCreateTopic = async () => {
		if (!newTopicName.trim()) return;

		try {
			setCreateLoading(true);
			const topicService = serviceManager.getService("topic");
			if (!topicService) {
				throw new Error("Topic service not available");
			}

			const newTopic = await topicService.createTopic({
				name: newTopicName.trim(),
				description: newTopicDescription.trim(),
			});

			// Add to topics list
			setTopics((prev) => [{ ...newTopic, contentCount: 0 }, ...prev]);

			// Reset form
			setNewTopicName("");
			setNewTopicDescription("");
			setShowCreateDialog(false);

			logInfo("[TOPICS_PAGE] Created new topic:", newTopic);
		} catch (error) {
			logError("[TOPICS_PAGE] Failed to create topic:", error);
		} finally {
			setCreateLoading(false);
		}
	};

	const handleEditTopic = async () => {
		if (!editingTopic || !editName.trim()) return;

		try {
			setEditLoading(true);
			const topicService = serviceManager.getService("topic");
			if (!topicService) {
				throw new Error("Topic service not available");
			}

			const updatedTopic = await topicService.updateTopic(editingTopic.id, {
				name: editName.trim(),
				description: editDescription.trim(),
			});

			// Update topics list
			setTopics((prev) =>
				prev.map((topic) =>
					topic.id === editingTopic.id
						? { ...updatedTopic, contentCount: topic.contentCount }
						: topic,
				),
			);

			// Reset form
			setEditingTopic(null);
			setEditName("");
			setEditDescription("");

			logInfo("[TOPICS_PAGE] Updated topic:", updatedTopic);
		} catch (error) {
			logError("[TOPICS_PAGE] Failed to update topic:", error);
		} finally {
			setEditLoading(false);
		}
	};

	const handleDeleteTopic = async (topic: Topic) => {
		if (
			!confirm(
				`Are you sure you want to delete "${topic.name}"? This action cannot be undone.`,
			)
		) {
			return;
		}

		try {
			const topicService = serviceManager.getService("topic");
			if (!topicService) {
				throw new Error("Topic service not available");
			}

			await topicService.deleteTopic(topic.id);

			// Remove from topics list
			setTopics((prev) => prev.filter((t) => t.id !== topic.id));

			logInfo("[TOPICS_PAGE] Deleted topic:", topic);
		} catch (error) {
			logError("[TOPICS_PAGE] Failed to delete topic:", error);
		}
	};

	const startEditTopic = (topic: Topic) => {
		setEditingTopic(topic);
		setEditName(topic.name);
		setEditDescription(topic.description || "");
	};

	const TopicItem: React.FC<{ topic: TopicWithCount }> = ({ topic }) => (
		<div className="group p-3 cursor-pointer hover:bg-muted/50 transition-colors">
			<div className="space-y-2">
				<div className="flex items-start justify-between">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<Tags className="w-4 h-4 text-primary flex-shrink-0" />
							<h3 className="font-medium text-sm truncate">{topic.name}</h3>
						</div>
						<p className="text-xs text-muted-foreground mt-1 line-clamp-2">
							{topic.description}
						</p>
					</div>
					<div className="flex items-center gap-1 ml-2">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
								>
									<MoreVertical className="w-3 h-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => startEditTopic(topic)}>
									<Edit2 className="w-4 h-4 mr-2" />
									Edit
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => handleDeleteTopic(topic)}
									className="text-destructive"
								>
									<Trash2 className="w-4 h-4 mr-2" />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<Badge variant="secondary" className="text-xs">
						<FileText className="w-3 h-3 mr-1" />
						{topic.contentCount || 0} content
						{(topic.contentCount || 0) !== 1 ? "s" : ""}
					</Badge>
					<span>{new Date(topic.createdAt).toLocaleDateString()}</span>
				</div>
			</div>
		</div>
	);

	if (loading) {
		return (
			<div className="flex flex-col h-full bg-background">
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center space-y-4">
						<Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
						<p className="text-muted-foreground">Loading topics...</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full bg-background">
			{/* Header */}
			<div className="border-b border-border bg-card">
				<div className="p-3">
					<div className="flex items-center justify-between mb-4">
						<div>
							<h1 className="text-xl font-bold text-foreground flex items-center gap-2">
								<Tags className="w-5 h-5 text-primary" />
								Topics
							</h1>
							<p className="text-sm text-muted-foreground mt-1">
								Organize your knowledge into focused topics
							</p>
						</div>
						<Button
							onClick={() => setShowCreateDialog(true)}
							size="sm"
							className="gap-2"
						>
							<Plus className="w-4 h-4" />
							New Topic
						</Button>
					</div>

					{/* Search */}
					<div className="relative">
						<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search topics..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="pl-10"
						/>
					</div>
				</div>
			</div>

			{/* Content */}
			<ScrollArea className="h-full">
				{filteredTopics.length === 0 ? (
					<div className="p-3 text-center text-muted-foreground">
						{searchTerm
							? "No topics match your search"
							: "No topics created yet"}
					</div>
				) : (
					<div className="divide-y divide-border">
						{filteredTopics.map((topic) => (
							<TopicItem key={topic.id} topic={topic} />
						))}
					</div>
				)}
			</ScrollArea>

			{/* Create Topic Dialog */}
			<Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Create New Topic</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<label htmlFor="topic-name" className="text-sm font-medium">
								Topic Name *
							</label>
							<Input
								id="topic-name"
								placeholder="e.g., Machine Learning, React Development..."
								value={newTopicName}
								onChange={(e) => setNewTopicName(e.target.value)}
								onKeyDown={(e) => {
									if (
										e.key === "Enter" &&
										newTopicName.trim() &&
										newTopicDescription.trim()
									) {
										handleCreateTopic();
									}
								}}
							/>
						</div>
						<div className="space-y-2">
							<label
								htmlFor="topic-description"
								className="text-sm font-medium"
							>
								Goal & Purpose *
							</label>
							<Textarea
								id="topic-description"
								placeholder="Describe what you want to achieve with this topic. What specific knowledge or skills are you building? This helps the AI extract and organize relevant information effectively."
								value={newTopicDescription}
								onChange={(e) => setNewTopicDescription(e.target.value)}
								rows={3}
							/>
							<p className="text-xs text-muted-foreground">
								Example: "Learn modern React patterns and best practices for
								building scalable web applications"
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setShowCreateDialog(false)}
							disabled={createLoading}
						>
							Cancel
						</Button>
						<Button
							onClick={handleCreateTopic}
							disabled={
								!newTopicName.trim() ||
								!newTopicDescription.trim() ||
								createLoading
							}
						>
							{createLoading ? (
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
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Edit Topic Dialog */}
			<Dialog
				open={!!editingTopic}
				onOpenChange={(open) => !open && setEditingTopic(null)}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Edit Topic</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<label htmlFor="edit-topic-name" className="text-sm font-medium">
								Topic Name *
							</label>
							<Input
								id="edit-topic-name"
								placeholder="Enter topic name..."
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && editName.trim()) {
										handleEditTopic();
									}
								}}
							/>
						</div>
						<div className="space-y-2">
							<label
								htmlFor="edit-topic-description"
								className="text-sm font-medium"
							>
								Goal & Purpose *
							</label>
							<Textarea
								id="edit-topic-description"
								placeholder="Describe what you want to achieve with this topic..."
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
								rows={3}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setEditingTopic(null)}
							disabled={editLoading}
						>
							Cancel
						</Button>
						<Button
							onClick={handleEditTopic}
							disabled={
								!editName.trim() || !editDescription.trim() || editLoading
							}
						>
							{editLoading ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Saving...
								</>
							) : (
								<>
									<Edit2 className="w-4 h-4 mr-2" />
									Save Changes
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};
