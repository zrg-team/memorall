import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Search,
	Heart,
	Archive,
	ExternalLink,
	Clock,
	BookOpen,
	Star,
	Trash2,
	ArrowLeft,
	Brain,
	CheckCircle2,
	XCircle,
	Loader2,
	MoreVertical,
} from "lucide-react";
import {
	rememberService,
	type SearchOptions,
} from "@/modules/remember/services/remember-service";
import { knowledgeGraphService } from "@/modules/knowledge/services/knowledge-graph-service";
import type {
	RememberedContent,
	Node,
	Edge,
	Topic,
} from "@/services/database/db";
import { serviceManager } from "@/services";
import type {
	ConversionProgress,
	ConversionStatus,
} from "@/types/knowledge-graph";
import { logError } from "@/utils/logger";
import { eq, and, inArray } from "drizzle-orm";
import { getEffectiveSourceStatus } from "@/services/database/entities/sources";
import { D3KnowledgeGraph } from "@/modules/knowledge/components/D3KnowledgeGraph";

// Helper function to get URL from the new data structure
function getContentUrl(content: RememberedContent): string {
	if (content.sourceUrl) return content.sourceUrl;
	if (content.originalUrl) return content.originalUrl;
	return `content://${content.id}`;
}

const statusColors: Record<ConversionStatus, string> = {
	pending: "bg-muted text-muted-foreground",
	loading_existing_data:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	extracting_entities:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	resolving_entities:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	extracting_facts:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	resolving_facts:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	extracting_temporal:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	saving_to_database:
		"bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
	completed:
		"bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
	failed: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const statusIcons: Record<ConversionStatus, React.ReactElement> = {
	pending: <Clock className="h-4 w-4" />,
	loading_existing_data: <Loader2 className="h-4 w-4 animate-spin" />,
	extracting_entities: <Loader2 className="h-4 w-4 animate-spin" />,
	resolving_entities: <Loader2 className="h-4 w-4 animate-spin" />,
	extracting_facts: <Loader2 className="h-4 w-4 animate-spin" />,
	resolving_facts: <Loader2 className="h-4 w-4 animate-spin" />,
	extracting_temporal: <Loader2 className="h-4 w-4 animate-spin" />,
	saving_to_database: <Loader2 className="h-4 w-4 animate-spin" />,
	completed: <CheckCircle2 className="h-4 w-4" />,
	failed: <XCircle className="h-4 w-4" />,
};

interface RememberedContentsPageProps {}

export const RememberedContentsPage: React.FC<
	RememberedContentsPageProps
> = () => {
	const [contents, setContents] = useState<RememberedContent[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedContent, setSelectedContent] =
		useState<RememberedContent | null>(null);
	const [selectedContentTopic, setSelectedContentTopic] =
		useState<Topic | null>(null);
	const [showMobileDetail, setShowMobileDetail] = useState(false);
	const [filters, setFilters] = useState({
		showFavorites: false,
	});
	const [activeTab, setActiveTab] = useState<"content" | "graph">("content");

	// Knowledge graph state
	const [conversions, setConversions] = useState<
		Map<string, ConversionProgress>
	>(new Map());
	const [graphData, setGraphData] = useState<{
		nodes: Node[];
		edges: Edge[];
	} | null>(null);
	const [sourceStatuses, setSourceStatuses] = useState<
		Map<
			string,
			{ status: string; validFrom: Date | null; effectiveStatus: string }
		>
	>(new Map());

	// Subscribe to conversion updates
	useEffect(() => {
		const unsubscribe = knowledgeGraphService.subscribe((newConversions) => {
			setConversions(new Map(newConversions));

			// Reload source statuses when conversions change
			const changedPageIds = Array.from(newConversions.values())
				.filter(
					(conv) => conv.status === "completed" || conv.status === "failed",
				)
				.map((conv) => conv.pageId);

			if (changedPageIds.length > 0) {
				loadSourceStatuses(changedPageIds);
			}
		});

		return unsubscribe;
	}, []);

	const loadPages = async (searchOptions?: Partial<SearchOptions>) => {
		try {
			setLoading(true);
			const result = await rememberService.searchPages({
				query: searchQuery,
				isFavorite: filters.showFavorites ? true : undefined,
				limit: 50,
				sortBy: "createdAt",
				sortOrder: "desc",
				...searchOptions,
			});
			setContents(result.pages);

			// Load source statuses and topics for all pages
			if (result.pages.length > 0) {
				const pageIds = result.pages.map((p) => p.id);
				await loadSourceStatuses(pageIds);
			}
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

		// Load graph data for this content
		await loadGraphDataForPage(content.id);
	};

	const handleBackToList = () => {
		setShowMobileDetail(false);
	};

	const handleConvertToGraph = async (page: RememberedContent) => {
		try {
			const { backgroundJob } = await import(
				"@/services/background-jobs/background-job"
			);
			await backgroundJob.createJob("knowledge-graph", page, {
				stream: false,
			});
			await loadSourceStatuses([page.id]);
		} catch (error) {
			logError("Failed to start knowledge graph conversion:", error);
		}
	};

	const loadGraphDataForPage = async (pageId: string) => {
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Find sources related to this page
				const sources = await db
					.select()
					.from(schema.sources)
					.where(
						and(
							eq(schema.sources.targetType, "remembered_pages"),
							eq(schema.sources.targetId, pageId),
						),
					);

				if (sources.length === 0) {
					setGraphData({ nodes: [], edges: [] });
					return;
				}

				const sourceIds = sources.map((s) => s.id);

				// Get nodes related to these sources
				const sourceNodes = await db
					.select({
						nodeId: schema.sourceNodes.nodeId,
					})
					.from(schema.sourceNodes)
					.where(inArray(schema.sourceNodes.sourceId, sourceIds));

				const nodeIds = sourceNodes.map((sn) => sn.nodeId);

				let nodes: Node[] = [];
				let edges: Edge[] = [];

				if (nodeIds.length > 0) {
					nodes = await db
						.select()
						.from(schema.nodes)
						.where(inArray(schema.nodes.id, nodeIds));

					edges = await db
						.select()
						.from(schema.edges)
						.where(
							and(
								inArray(schema.edges.sourceId, nodeIds),
								inArray(schema.edges.destinationId, nodeIds),
							),
						);
				}

				setGraphData({ nodes, edges });
			});
		} catch (error) {
			logError("Failed to load graph data for page:", error);
			setGraphData({ nodes: [], edges: [] });
		}
	};

	const loadSourceStatuses = async (pageIds: string[]) => {
		try {
			const statusMap = new Map<
				string,
				{ status: string; validFrom: Date | null; effectiveStatus: string }
			>();
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const sources = await db
					.select()
					.from(schema.sources)
					.where(
						and(
							eq(schema.sources.targetType, "remembered_pages"),
							inArray(schema.sources.targetId, pageIds),
						),
					);

				sources.forEach((source) => {
					const effectiveStatus = getEffectiveSourceStatus(source);
					statusMap.set(source.targetId, {
						status: source.status || "pending",
						validFrom: source.statusValidFrom,
						effectiveStatus,
					});
				});
			});
			setSourceStatuses(statusMap);
		} catch (error) {
			logError("Failed to load source statuses:", error);
		}
	};

	const getConversionForPage = (pageId: string): ConversionProgress | null => {
		const sourceData = sourceStatuses.get(pageId);
		if (sourceData && sourceData.status !== "pending") {
			const effectiveStatus = sourceData.effectiveStatus;
			const page = contents.find((p) => p.id === pageId);
			return {
				pageId,
				pageTitle: page?.title || "Unknown",
				pageUrl: page ? getContentUrl(page) : "",
				status:
					effectiveStatus === "completed"
						? "completed"
						: effectiveStatus === "failed"
							? "failed"
							: effectiveStatus === "processing"
								? "extracting_entities"
								: "pending",
				stage:
					effectiveStatus === "completed"
						? "Completed successfully"
						: effectiveStatus === "failed"
							? "Failed (timeout or error)"
							: effectiveStatus === "processing"
								? "Processing..."
								: "Pending",
				progress:
					effectiveStatus === "completed"
						? 100
						: effectiveStatus === "failed"
							? 0
							: 50,
				startedAt: sourceData.validFrom || new Date(),
				completedAt:
					effectiveStatus === "completed" || effectiveStatus === "failed"
						? new Date()
						: undefined,
			};
		}

		const memoryConversion = conversions.get(pageId);
		if (memoryConversion) {
			return memoryConversion;
		}

		return null;
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

	const isConverting = Array.from(sourceStatuses.values()).some(
		(sourceData) => sourceData.effectiveStatus === "processing",
	);

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

						<Button
							variant={filters.showFavorites ? "default" : "outline"}
							size="sm"
							onClick={() =>
								setFilters((prev) => ({
									showFavorites: !prev.showFavorites,
								}))
							}
						>
							<Star className="h-4 w-4 mr-1" />
							Favorites
						</Button>
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
							{contents.map((content) => {
								const conversion = getConversionForPage(content.id);
								return (
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
												<h3 className="font-medium text-sm line-clamp-2 text-foreground">
													{content.title}
												</h3>
												<div className="flex items-center gap-1 ml-2">
													{content.isFavorite && (
														<Heart className="h-3 w-3 text-red-500 fill-current" />
													)}
													{conversion && (
														<TooltipProvider>
															<Tooltip>
																<TooltipTrigger>
																	<Badge
																		className={`text-xs ${statusColors[conversion.status]}`}
																	>
																		{statusIcons[conversion.status]}
																	</Badge>
																</TooltipTrigger>
																<TooltipContent>
																	{conversion.stage}
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													)}
												</div>
											</div>

											{conversion &&
												conversion.status !== "completed" &&
												conversion.status !== "failed" && (
													<Progress
														value={conversion.progress}
														className="h-1"
													/>
												)}

											<p className="text-xs text-muted-foreground line-clamp-2">
												{content.content.substring(0, 100)}...
											</p>

											<div className="flex items-center justify-between text-xs text-muted-foreground">
												<span>{formatDomain(getContentUrl(content))}</span>
												<span>{formatDate(content.createdAt)}</span>
											</div>
										</div>
									</div>
								);
							})}
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
						<div className="border-b border-border bg-card p-3 relative">
							<div className="flex items-start gap-3 pr-8">
								{/* Back Button (Mobile) */}
								<Button
									variant="ghost"
									size="sm"
									onClick={handleBackToList}
									className="sm:hidden flex-shrink-0"
								>
									<ArrowLeft className="h-4 w-4" />
								</Button>

								{/* Page Info */}
								<div className="flex-1 min-w-0">
									<h1 className="text-xl font-semibold text-foreground line-clamp-1 mb-1">
										{selectedContent.title}
									</h1>
									<div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap mb-3">
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
										{Array.isArray(selectedContent.tags) &&
											selectedContent.tags.length > 0 &&
											selectedContent.tags.map((tag, index) => (
												<Badge
													key={index}
													variant="secondary"
													className="text-xs"
												>
													{tag}
												</Badge>
											))}
									</div>

									{/* Actions Row */}
									<div className="flex items-center gap-2 flex-wrap">
										<TooltipProvider>
											{/* Primary Action - Convert */}
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="default"
														size="sm"
														onClick={() =>
															handleConvertToGraph(selectedContent)
														}
														disabled={isConverting}
													>
														{isConverting ? (
															<>
																<Loader2 className="h-4 w-4 mr-2 animate-spin" />
																Converting...
															</>
														) : (
															<>
																<Brain className="h-4 w-4 mr-2" />
																Generate
															</>
														)}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													Convert content to Knowledge Graph
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>

										{/* View Mode Toggle - Compact */}
										<div className="inline-flex items-center rounded-md bg-muted p-1 gap-1">
											<button
												onClick={() => setActiveTab("content")}
												className={`inline-flex items-center justify-center rounded-sm px-2 py-1 text-sm font-medium transition-all ${
													activeTab === "content"
														? "bg-background text-foreground shadow-sm"
														: "text-muted-foreground hover:text-foreground"
												}`}
											>
												<BookOpen className="h-4 w-4" />
												{activeTab === "content" && (
													<span className="ml-1.5">Content</span>
												)}
											</button>
											<button
												onClick={() => setActiveTab("graph")}
												className={`inline-flex items-center justify-center rounded-sm px-2 py-1 text-sm font-medium transition-all ${
													activeTab === "graph"
														? "bg-background text-foreground shadow-sm"
														: "text-muted-foreground hover:text-foreground"
												}`}
											>
												<Brain className="h-4 w-4" />
												{activeTab === "graph" && (
													<span className="ml-1.5">Graph</span>
												)}
											</button>
										</div>
									</div>
								</div>
							</div>

							{/* More Menu (Absolute Top Right) */}
							<div className="absolute top-3 right-3">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="sm">
											<MoreVertical className="h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onClick={() => handleToggleFavorite(selectedContent)}
										>
											<Heart
												className={`h-4 w-4 mr-2 ${
													selectedContent.isFavorite
														? "text-red-500 fill-current"
														: ""
												}`}
											/>
											{selectedContent.isFavorite
												? "Remove from Favorites"
												: "Add to Favorites"}
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => handleDelete(selectedContent)}
											className="text-red-600 focus:text-red-600"
										>
											<Trash2 className="h-4 w-4 mr-2" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>

						{/* Content Area */}
						<div className="flex-1 overflow-hidden">
							{activeTab === "content" ? (
								<ScrollArea className="h-full px-3 py-3">
									<div
										className="prose max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-a:text-primary prose-code:text-foreground prose-pre:bg-muted prose-blockquote:text-muted-foreground prose-li:text-foreground whitespace-pre-wrap"
										dangerouslySetInnerHTML={{
											__html: selectedContent.content,
										}}
									/>
								</ScrollArea>
							) : (
								<div className="h-full px-3 py-3">
									{(() => {
										const sourceData = sourceStatuses.get(selectedContent.id);
										const isLoading =
											sourceData?.effectiveStatus === "processing";

										if (isLoading) {
											return (
												<div className="flex items-center justify-center h-full">
													<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
													<span className="ml-2 text-muted-foreground">
														Loading knowledge graph...
													</span>
												</div>
											);
										}

										if (
											!graphData ||
											(graphData.nodes.length === 0 &&
												graphData.edges.length === 0)
										) {
											return (
												<div className="flex flex-col items-center justify-center h-full text-center">
													<Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
													<p className="text-lg font-medium">
														No knowledge graph available
													</p>
													<p className="text-sm text-muted-foreground mb-4">
														Convert this content to generate a knowledge graph
													</p>
													<Button
														onClick={() =>
															handleConvertToGraph(selectedContent)
														}
														disabled={isConverting}
													>
														{isConverting ? (
															<Loader2 className="h-4 w-4 mr-1 animate-spin" />
														) : (
															<Brain className="h-4 w-4 mr-1" />
														)}
														Convert to Knowledge Graph
													</Button>
												</div>
											);
										}

										return (
											<D3KnowledgeGraph
												selectedPageId={selectedContent.id}
												graphData={graphData}
												width={800}
												height={600}
											/>
										);
									})()}
								</div>
							)}
						</div>
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
