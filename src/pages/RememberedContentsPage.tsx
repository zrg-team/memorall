import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Search,
	Heart,
	Archive,
	ExternalLink,
	Clock,
	BookOpen,
	Star,
	ArchiveX,
	Trash2,
	ArrowLeft,
} from "lucide-react";
import {
	rememberService,
	type SearchOptions,
} from "@/modules/remember/services/remember/remember-service";
import type { RememberedContent } from "@/services/database/db";
import { logError } from "@/utils/logger";

// Helper function to get URL from the new data structure
function getContentUrl(content: RememberedContent): string {
	if (content.sourceUrl) return content.sourceUrl;
	if (content.originalUrl) return content.originalUrl;
	return `content://${content.id}`;
}

interface RememberedContentsPageProps {}

export const RememberedContentsPage: React.FC<
	RememberedContentsPageProps
> = () => {
	const [contents, setContents] = useState<RememberedContent[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedContent, setSelectedContent] =
		useState<RememberedContent | null>(null);
	const [selectedContentTopic, setSelectedContentTopic] = useState<any>(null);
	const [showMobileDetail, setShowMobileDetail] = useState(false);
	const [filters, setFilters] = useState({
		showArchived: false,
		showFavorites: false,
	});

	const loadPages = async (searchOptions?: Partial<SearchOptions>) => {
		try {
			setLoading(true);
			const result = await rememberService.searchPages({
				query: searchQuery,
				isArchived: filters.showArchived ? true : undefined,
				isFavorite: filters.showFavorites ? true : undefined,
				limit: 50,
				sortBy: "createdAt",
				sortOrder: "desc",
				...searchOptions,
			});
			setContents(result.pages);
		} catch (error) {
			logError("Failed to load remembered pages:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadPages();
	}, [filters]);

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			if (searchQuery !== "") {
				loadPages({ query: searchQuery });
			} else {
				loadPages();
			}
		}, 300);

		return () => clearTimeout(debounceTimer);
	}, [searchQuery]);

	const handleToggleFavorite = async (page: RememberedContent) => {
		try {
			await rememberService.toggleFavorite(page.id);
			await loadPages();
		} catch (error) {
			logError("Failed to toggle favorite:", error);
		}
	};

	const handleToggleArchive = async (page: RememberedContent) => {
		try {
			await rememberService.toggleArchive(page.id);
			await loadPages();
		} catch (error) {
			logError("Failed to toggle archive:", error);
		}
	};

	const handleDelete = async (page: RememberedContent) => {
		if (confirm(`Are you sure you want to delete "${page.title}"?`)) {
			try {
				await rememberService.deletePage(page.id);
				await loadPages();
				if (selectedContent?.id === page.id) {
					setSelectedContent(null);
					setShowMobileDetail(false);
				}
			} catch (error) {
				logError("Failed to delete page:", error);
			}
		}
	};

	const handleContentSelect = async (content: RememberedContent) => {
		setSelectedContent(content);
		setShowMobileDetail(true);

		// Fetch topic information if content has a topicId
		if (content.topicId) {
			try {
				const topic = await rememberService.getTopicForContent(content.topicId);
				setSelectedContentTopic(topic);
			} catch (error) {
				logError("Failed to load topic:", error);
				setSelectedContentTopic(null);
			}
		} else {
			setSelectedContentTopic(null);
		}
	};

	const handleBackToList = () => {
		setShowMobileDetail(false);
	};

	const formatDate = (date: string | Date) => {
		const dateObj = typeof date === "string" ? new Date(date) : date;
		return dateObj.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const formatDomain = (url: string) => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	};

	return (
		<div className="flex flex-col sm:flex-row h-full overflow-hidden bg-background">
			{/* Sidebar with page list */}
			<div
				className={`w-full sm:w-1/3 border-r sm:border-r border-b sm:border-b-0 bg-card border-border ${showMobileDetail ? "hidden sm:block" : ""} ${!showMobileDetail ? "h-full" : ""}`}
			>
				<div className="p-3 border-b border-border">
					<div className="space-y-4">
						<div className="relative">
							<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search remembered pages..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-10"
							/>
						</div>

						<div className="flex gap-2">
							<Button
								variant={filters.showFavorites ? "default" : "outline"}
								size="sm"
								onClick={() =>
									setFilters((prev) => ({
										...prev,
										showFavorites: !prev.showFavorites,
									}))
								}
							>
								<Star className="h-4 w-4 mr-1" />
								Favorites
							</Button>

							<Button
								variant={filters.showArchived ? "default" : "outline"}
								size="sm"
								onClick={() =>
									setFilters((prev) => ({
										...prev,
										showArchived: !prev.showArchived,
									}))
								}
							>
								<Archive className="h-4 w-4 mr-1" />
								Archived
							</Button>
						</div>
					</div>
				</div>

				<ScrollArea className="h-full">
					{loading ? (
						<div className="p-3 text-center text-muted-foreground">
							Loading pages...
						</div>
					) : contents.length === 0 ? (
						<div className="p-3 text-center text-muted-foreground">
							{searchQuery
								? "No pages match your search"
								: "No pages remembered yet"}
						</div>
					) : (
						<div className="divide-y divide-border">
							{contents.map((content) => (
								<div
									key={content.id}
									className={`p-3 cursor-pointer hover:bg-muted/50 ${
										selectedContent?.id === content.id
											? "bg-accent border-r-2 border-primary"
											: ""
									}`}
									onClick={() => handleContentSelect(content)}
								>
									<div className="space-y-2">
										<div className="flex items-start justify-between">
											<h3 className="font-medium text-sm line-clamp-2 text-foreground line-clamp-2">
												{content.title}
											</h3>
											<div className="flex items-center gap-1 ml-2">
												{content.isFavorite && (
													<Heart className="h-3 w-3 text-red-500 fill-current" />
												)}
												{content.isArchived && (
													<Archive className="h-3 w-3 text-muted-foreground" />
												)}
											</div>
										</div>

										<p className="text-xs text-muted-foreground line-clamp-2">
											{content.content.substring(0, 100)}...
										</p>

										<div className="flex items-center justify-between text-xs text-muted-foreground">
											<span>{formatDomain(getContentUrl(content))}</span>
											<span>{formatDate(content.createdAt)}</span>
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</ScrollArea>
			</div>

			{/* Main content area */}
			<div
				className={`flex-1 ${!showMobileDetail ? "hidden sm:block" : ""} ${showMobileDetail ? "h-full" : ""}`}
			>
				{selectedContent ? (
					<div className="h-full flex flex-col">
						{/* Header */}
						<div className="border-b border-border bg-card p-3">
							<div className="flex items-center justify-between">
								<div className="flex-1">
									<div className="flex items-center gap-2 mb-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={handleBackToList}
											className="sm:hidden"
										>
											<ArrowLeft className="h-4 w-4" />
										</Button>
										<h1 className="text-xl font-semibold text-foreground line-clamp-2">
											{selectedContent.title}
										</h1>
									</div>
									<div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
										<span className="flex items-center gap-1">
											<ExternalLink className="h-4 w-4" />
											<a
												href={getContentUrl(selectedContent)}
												target="_blank"
												rel="noopener noreferrer"
												className="hover:text-primary underline"
											>
												{formatDomain(getContentUrl(selectedContent))}
											</a>
										</span>
										<span className="flex items-center gap-1">
											<Clock className="h-4 w-4" />
											{formatDate(selectedContent.createdAt)}
										</span>
										<span className="flex items-center gap-1">
											<BookOpen className="h-4 w-4" />
											{Math.round((selectedContent.content.length || 0) / 250)}{" "}
											min read
										</span>
										{selectedContentTopic && (
											<Badge variant="outline" className="text-xs">
												{selectedContentTopic.name}
											</Badge>
										)}
									</div>
								</div>

								<div className="flex items-center gap-2">
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleToggleFavorite(selectedContent)}
												>
													<Heart
														className={`h-4 w-4 ${
															selectedContent.isFavorite
																? "text-red-500 fill-current"
																: "text-muted-foreground"
														}`}
													/>
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												{selectedContent.isFavorite
													? "Remove from favorites"
													: "Add to favorites"}
											</TooltipContent>
										</Tooltip>

										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleToggleArchive(selectedContent)}
												>
													{selectedContent.isArchived ? (
														<ArchiveX className="h-4 w-4 text-muted-foreground" />
													) : (
														<Archive className="h-4 w-4 text-muted-foreground" />
													)}
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												{selectedContent.isArchived ? "Unarchive" : "Archive"}
											</TooltipContent>
										</Tooltip>

										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleDelete(selectedContent)}
												>
													<Trash2 className="h-4 w-4 text-red-500" />
												</Button>
											</TooltipTrigger>
											<TooltipContent>Delete page</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
							</div>

							{/* Tags */}
							{Array.isArray(selectedContent.tags) &&
								selectedContent.tags.length > 0 && (
									<div className="flex gap-1 mt-2">
										{selectedContent.tags.map((tag, index) => (
											<Badge
												key={index}
												variant="secondary"
												className="text-xs"
											>
												{tag}
											</Badge>
										))}
									</div>
								)}
						</div>

						{/* Content */}
						<ScrollArea className="flex-1 p-3 overflow-auto bg-background">
							<div
								className="prose max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-a:text-primary prose-code:text-foreground prose-pre:bg-muted prose-blockquote:text-muted-foreground prose-li:text-foreground"
								dangerouslySetInnerHTML={{
									__html: selectedContent.content,
								}}
							/>
						</ScrollArea>
					</div>
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground bg-background">
						<div className="text-center">
							<BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
							<p className="text-lg font-medium">Select a page to read</p>
							<p className="text-sm">
								Choose from your remembered pages on the left
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
