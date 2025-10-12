import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import type { Topic } from "@/services/database/entities/topics";
import { logError, logInfo } from "@/utils/logger";
import { topicService } from "@/modules/topics/services/topic-service";

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

	// Sticky note colors (rotating through pastel colors)
	const stickyColors = [
		"bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800",
		"bg-pink-100 dark:bg-pink-900/30 border-pink-200 dark:border-pink-800",
		"bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800",
		"bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800",
		"bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800",
		"bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800",
	];

	const getColorForTopic = (topicId: string) => {
		const hash = topicId
			.split("")
			.reduce((acc, char) => acc + char.charCodeAt(0), 0);
		return stickyColors[hash % stickyColors.length];
	};

	const TopicCard: React.FC<{ topic: TopicWithCount }> = ({ topic }) => (
		<div
			className={`group relative p-4 rounded-lg border-2 transition-all hover:shadow-lg hover:scale-105 cursor-pointer min-h-[180px] flex flex-col ${getColorForTopic(topic.id)}`}
		>
			{/* More Menu - Top Right */}
			<div className="absolute top-2 right-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0 hover:bg-black/10 dark:hover:bg-white/10"
						>
							<MoreVertical className="w-4 h-4" />
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

			{/* Content */}
			<div className="flex-1 flex flex-col gap-2">
				<div className="flex items-start gap-2 pr-8">
					<Tags className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
					<h3 className="font-semibold text-base text-foreground leading-tight break-words">
						{topic.name}
					</h3>
				</div>
				<p className="text-sm text-muted-foreground line-clamp-3 flex-1">
					{topic.description}
				</p>
			</div>

			{/* Footer */}
			<div className="flex items-center justify-between pt-3 border-t border-current/10 text-xs text-muted-foreground">
				<Badge variant="secondary" className="text-xs">
					<FileText className="w-3 h-3 mr-1" />
					{topic.contentCount || 0}
				</Badge>
				<span>{new Date(topic.createdAt).toLocaleDateString()}</span>
			</div>
		</div>
	);

	const TopicListItem: React.FC<{ topic: TopicWithCount }> = ({ topic }) => (
		<div className="group p-3 hover:bg-muted/50 transition-colors border-b border-border">
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<Tags className="w-4 h-4 text-primary flex-shrink-0" />
						<h3 className="font-medium text-sm truncate">{topic.name}</h3>
					</div>
					<p className="text-xs text-muted-foreground line-clamp-2">
						{topic.description}
					</p>
					<div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
						<Badge variant="secondary" className="text-xs">
							<FileText className="w-3 h-3 mr-1" />
							{topic.contentCount || 0}
						</Badge>
						<span>{new Date(topic.createdAt).toLocaleDateString()}</span>
					</div>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 p-0"
						>
							<MoreVertical className="w-4 h-4" />
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
					<div className="p-8 text-center text-muted-foreground">
						<Tags className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p className="text-lg font-medium">
							{searchTerm
								? "No topics match your search"
								: "No topics created yet"}
						</p>
						{!searchTerm && (
							<p className="text-sm mt-1">
								Create your first topic to start organizing knowledge
							</p>
						)}
					</div>
				) : (
					<>
						{/* Card Grid Layout - Large Screens */}
						<div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
							{filteredTopics.map((topic) => (
								<TopicCard key={topic.id} topic={topic} />
							))}
						</div>

						{/* List Layout - Small Screens */}
						<div className="sm:hidden">
							{filteredTopics.map((topic) => (
								<TopicListItem key={topic.id} topic={topic} />
							))}
						</div>
					</>
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
