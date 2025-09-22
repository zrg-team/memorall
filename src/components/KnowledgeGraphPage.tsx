import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Search,
	Play,
	Trash2,
	Brain,
	Clock,
	CheckCircle2,
	XCircle,
	Loader2,
	ExternalLink,
	ArrowLeft,
} from "lucide-react";
import {
	rememberService,
	type SearchOptions,
} from "@/services/remember/remember-service";
import { knowledgeGraphService } from "@/services/knowledge-graph/knowledge-graph-service";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { RememberedContent, Node, Edge } from "@/services/database/db";
import { serviceManager } from "@/services";

// Helper function to get URL from the new data structure
function getContentUrl(content: RememberedContent): string {
	if (content.sourceUrl) return content.sourceUrl;
	if (content.originalUrl) return content.originalUrl;
	return `content://${content.id}`;
}

import type {
	ConversionProgress,
	ConversionStatus,
} from "@/types/knowledge-graph";
import { logError } from "@/utils/logger";
import { D3KnowledgeGraph } from "./D3KnowledgeGraph";
import { eq, and, inArray } from "drizzle-orm";

interface KnowledgeGraphPageProps {}

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

export const KnowledgeGraphPage: React.FC<KnowledgeGraphPageProps> = () => {
	const [pages, setPages] = useState<RememberedContent[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPage, setSelectedPage] = useState<RememberedContent | null>(
		null,
	);
	const [showMobileDetail, setShowMobileDetail] = useState(false);
	const [showMobileGraph, setShowMobileGraph] = useState(false);
	const [conversions, setConversions] = useState<
		Map<string, ConversionProgress>
	>(new Map());
	const [backgroundJobs, setBackgroundJobs] = useState<any[]>([]);

	const [filterType, setFilterType] = useState<
		"all" | "converted" | "inProgress"
	>("all");

	const [graphData, setGraphData] = useState<{
		nodes: Node[];
		edges: Edge[];
	} | null>(null);
	const [loadingGraph, setLoadingGraph] = useState(false);
	const [sourceStatuses, setSourceStatuses] = useState<
		Map<string, { status: string; validFrom: Date | null }>
	>(new Map());

	// Subscribe to conversion updates
	useEffect(() => {
		const unsubscribe = knowledgeGraphService.subscribe((newConversions) => {
			setConversions(new Map(newConversions));

			// Reload source statuses when conversions complete
			const pageIds = pages.map((p) => p.id);
			if (pageIds.length > 0) {
				loadSourceStatuses(pageIds);
			}
		});

		return unsubscribe;
	}, [pages]);

	// Subscribe to background job updates
	useEffect(() => {
		const unsubscribe = backgroundJob.subscribe((state: any) => {
			setBackgroundJobs(Object.values(state.jobs));

			// Reload source statuses when jobs complete
			const pageIds = pages.map((p) => p.id);
			if (pageIds.length > 0) {
				loadSourceStatuses(pageIds);
			}
		});

		// Initialize background job queue
		backgroundJob.initialize();

		return () => {
			unsubscribe();
		};
	}, [pages]);

	const loadPages = async (searchOptions?: Partial<SearchOptions>) => {
		try {
			setLoading(true);
			const result = await rememberService.searchPages({
				query: searchQuery,
				limit: 100,
				sortBy: "createdAt",
				sortOrder: "desc",
				...searchOptions,
			});

			let filteredPages = result.pages;

			if (filterType === "converted") {
				// Show only pages that have knowledge graphs or completed source status
				const pagesWithKG: RememberedContent[] = [];
				for (const page of result.pages) {
					const kg = await knowledgeGraphService.getKnowledgeGraphForPage(
						page.id,
					);
					const sourceData = sourceStatuses.get(page.id);
					if (kg || sourceData?.status === "completed") {
						pagesWithKG.push(page);
					}
				}
				filteredPages = pagesWithKG;
			} else if (filterType === "inProgress") {
				// Show only pages currently being converted
				const inProgressPageIds = new Set(
					Array.from(conversions.values())
						.filter((c) => c.status !== "completed" && c.status !== "failed")
						.map((c) => c.pageId),
				);
				filteredPages = filteredPages.filter((p) =>
					inProgressPageIds.has(p.id),
				);
			}

			setPages(filteredPages);

			// Load source statuses for all pages
			if (filteredPages.length > 0) {
				const pageIds = filteredPages.map((p) => p.id);
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
	}, [filterType, conversions]);

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

	const handleConvertPage = async (page: RememberedContent) => {
		try {
			// Use background queue for conversion
			await backgroundJob.createJob("knowledge-graph", page, {
				stream: false,
			});
		} catch (error) {
			logError(
				"❌ KnowledgeGraphPage: Failed to start background job:",
				error,
			);
		}
	};

	const handleConvertSelected = async () => {
		if (selectedPage) {
			await handleConvertPage(selectedPage);
		}
	};

	const handleBatchConvert = async () => {
		const unconvertedPages = pages.filter(
			(page) =>
				!conversions.has(page.id) &&
				!backgroundJobs.some((job) => job.pageId === page.id),
		);
		if (unconvertedPages.length > 0) {
			// Add multiple pages to background queue (limit to 10 at a time)
			const pagesToConvert = unconvertedPages.slice(0, 10);
			for (const page of pagesToConvert) {
				await backgroundJob.createJob("knowledge-graph", page, {
					stream: false,
				});
			}
		}
	};

	const handleClearCompleted = async () => {
		// Clear both in-memory conversions and background jobs
		knowledgeGraphService.clearCompletedConversions();
		await backgroundJob.clearCompletedJobs();
	};

	const loadGraphDataForPage = async (pageId: string) => {
		setLoadingGraph(true);
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Step 1: Find sources related to this page using polymorphic relationship
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

				// Step 2: Get nodes related to these sources
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
					// Step 3: Get the actual nodes
					nodes = await db
						.select()
						.from(schema.nodes)
						.where(inArray(schema.nodes.id, nodeIds));

					// Step 4: Get edges between these nodes
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
		} finally {
			setLoadingGraph(false);
		}
	};

	const handlePageSelect = (page: RememberedContent) => {
		if (selectedPage?.id === page.id) {
			// If clicking the same page, unselect it to show full graph
			setSelectedPage(null);
			setShowMobileDetail(false);
			setGraphData(null);
		} else {
			// If clicking a different page, select it and load its graph data
			setSelectedPage(page);
			setShowMobileDetail(true);
			loadGraphDataForPage(page.id);
		}
	};

	const handleBackToList = () => {
		setShowMobileDetail(false);
		setShowMobileGraph(false);
	};

	const handleShowMobileGraph = () => {
		setShowMobileGraph(true);
	};

	const handleBackFromGraph = () => {
		setShowMobileGraph(false);
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

	const loadSourceStatuses = async (pageIds: string[]) => {
		try {
			const statusMap = new Map<
				string,
				{ status: string; validFrom: Date | null }
			>();
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const sources = await db
					.select({
						targetId: schema.sources.targetId,
						status: schema.sources.status,
						statusValidFrom: schema.sources.statusValidFrom,
					})
					.from(schema.sources)
					.where(
						and(
							eq(schema.sources.targetType, "remembered_pages"),
							inArray(schema.sources.targetId, pageIds),
						),
					);

				sources.forEach((source) => {
					if (source.status) {
						statusMap.set(source.targetId, {
							status: source.status,
							validFrom: source.statusValidFrom,
						});
					}
				});
			});
			setSourceStatuses(statusMap);
		} catch (error) {
			logError("Failed to load source statuses:", error);
		}
	};

	const getConversionForPage = (pageId: string): ConversionProgress | null => {
		// First check background jobs
		const backgroundJob = backgroundJobs.find((job) => job.pageId === pageId);
		if (backgroundJob) {
			return backgroundJob.progress;
		}

		// Check in-memory conversions
		const memoryConversion = conversions.get(pageId);
		if (memoryConversion) {
			return memoryConversion;
		}

		// Check source status from database
		const sourceData = sourceStatuses.get(pageId);
		if (sourceData && sourceData.status !== "pending") {
			let effectiveStatus = sourceData.status;

			// Check if processing status is expired (30 minutes)
			if (sourceData.status === "processing" && sourceData.validFrom) {
				const now = new Date();
				const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
				if (sourceData.validFrom < thirtyMinutesAgo) {
					effectiveStatus = "failed";
				}
			}

			// Create a conversion progress object from source status
			const page = pages.find((p) => p.id === pageId);
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

		return null;
	};

	const isConverting =
		Array.from(conversions.values()).some(
			(c) => c.status !== "completed" && c.status !== "failed",
		) ||
		backgroundJobs.some(
			(job) => job.status === "running" || job.status === "pending",
		);

	return (
		<div className="flex flex-col sm:flex-row h-full overflow-hidden bg-background">
			{/* Sidebar with page list */}
			<div
				className={`w-full sm:w-1/3 border-r sm:border-r border-b sm:border-b-0 bg-card border-border ${showMobileDetail || showMobileGraph ? "hidden sm:block" : ""} ${!(showMobileDetail || showMobileGraph) ? "h-full" : ""}`}
			>
				<div className="p-3 border-b border-border">
					<div className="space-y-3">
						<div className="flex gap-2">
							<div className="flex-1 relative">
								<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search pages..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-10"
								/>
							</div>
							<div className="w-32">
								<Select
									value={filterType}
									onValueChange={(value: "all" | "converted" | "inProgress") =>
										setFilterType(value)
									}
								>
									<SelectTrigger className="h-10">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All Pages</SelectItem>
										<SelectItem value="converted">Converted</SelectItem>
										<SelectItem value="inProgress">In Progress</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="flex gap-2">
							<Button
								onClick={handleBatchConvert}
								disabled={isConverting}
								size="sm"
							>
								{isConverting ? (
									<Loader2 className="h-4 w-4 mr-1 animate-spin" />
								) : (
									<Play className="h-4 w-4 mr-1" />
								)}
								Convert Batch
							</Button>

							<Button
								onClick={handleClearCompleted}
								variant="outline"
								size="sm"
							>
								<Trash2 className="h-4 w-4 mr-1" />
								Clear
							</Button>

							{/* Mobile Graph Button */}
							<Button
								onClick={handleShowMobileGraph}
								variant="outline"
								size="sm"
								className="sm:hidden"
							>
								<Brain className="h-4 w-4 mr-1" />
								Graph
							</Button>
						</div>
					</div>
				</div>

				<ScrollArea className="h-full">
					{loading ? (
						<div className="p-3 text-center text-muted-foreground">
							Loading pages...
						</div>
					) : pages.length === 0 ? (
						<div className="p-3 text-center text-muted-foreground">
							{searchQuery || filterType !== "all"
								? "No pages match your filters"
								: "No pages available"}
						</div>
					) : (
						<div className="divide-y divide-border">
							{pages.map((page) => {
								const conversion = getConversionForPage(page.id);
								return (
									<div
										key={page.id}
										className={`p-3 cursor-pointer hover:bg-muted/50 ${
											selectedPage?.id === page.id
												? "bg-accent border-r-2 border-primary"
												: ""
										}`}
										onClick={() => handlePageSelect(page)}
									>
										<div className="space-y-2">
											<div className="flex items-start justify-between">
												<h3 className="font-medium text-sm line-clamp-2 text-foreground">
													{page.title}
												</h3>
												<div className="flex items-center gap-1 ml-2">
													{conversion && (
														<Badge
															className={`text-xs ${statusColors[conversion.status]}`}
														>
															{statusIcons[conversion.status]}
															<span className="ml-1">
																{conversion.status.replace(/_/g, " ")}
															</span>
														</Badge>
													)}
												</div>
											</div>

											{conversion && (
												<div className="space-y-1">
													<div className="text-xs text-muted-foreground">
														{conversion.stage}
													</div>
													<Progress
														value={conversion.progress}
														className="h-1"
													/>
												</div>
											)}

											<p className="text-xs text-muted-foreground line-clamp-2">
												{page.textContent.substring(0, 100)}...
											</p>

											<div className="flex items-center justify-between text-xs text-muted-foreground">
												<span>{formatDomain(getContentUrl(page))}</span>
												<span>{formatDate(page.createdAt)}</span>
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</ScrollArea>
			</div>

			{/* Mobile Graph View */}
			{showMobileGraph && (
				<div className="w-full h-full sm:hidden">
					<div className="h-full flex flex-col">
						{/* Header */}
						<div className="border-b border-border bg-card p-3">
							<div className="flex items-center justify-between">
								<Button variant="ghost" size="sm" onClick={handleBackFromGraph}>
									<ArrowLeft className="h-4 w-4" />
								</Button>
								<h1 className="text-xl font-semibold text-foreground">
									Knowledge Graph
								</h1>
								<div></div>
							</div>
						</div>

						{/* Graph Content */}
						<div className="flex-1 overflow-hidden p-3 bg-background">
							<D3KnowledgeGraph width={800} height={600} />
						</div>
					</div>
				</div>
			)}

			{/* Main content area */}
			<div
				className={`flex-1 ${!showMobileDetail && !showMobileGraph ? "hidden sm:block" : ""} ${showMobileDetail && !showMobileGraph ? "h-full" : ""} ${showMobileGraph ? "hidden" : ""}`}
			>
				{selectedPage ? (
					<div className="h-full flex flex-col">
						{/* Header */}
						<div className="border-b border-border bg-card p-3">
							<div className="flex items-center justify-between">
								<div className="flex-1">
									<div className="flex items-center gap-2 mb-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setSelectedPage(null);
												setShowMobileDetail(false);
											}}
											className="hidden sm:block text-muted-foreground hover:text-foreground"
											title="Back to full graph"
										>
											<ArrowLeft className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={handleBackToList}
											className="sm:hidden"
										>
											<ArrowLeft className="h-4 w-4" />
										</Button>
										<h1 className="text-xl font-semibold text-foreground">
											{selectedPage.title}
										</h1>
									</div>
									<div className="flex items-center gap-3 text-sm text-muted-foreground">
										<span className="flex items-center gap-1">
											<ExternalLink className="h-4 w-4" />
											<a
												href={getContentUrl(selectedPage)}
												target="_blank"
												rel="noopener noreferrer"
												className="hover:text-primary underline"
											>
												{formatDomain(getContentUrl(selectedPage))}
											</a>
										</span>
										<span className="flex items-center gap-1">
											<Clock className="h-4 w-4" />
											{formatDate(selectedPage.createdAt)}
										</span>
									</div>
								</div>

								<div className="flex items-center gap-2">
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													onClick={handleConvertSelected}
													disabled={isConverting}
													size="sm"
												>
													{isConverting ? (
														<Loader2 className="h-4 w-4 mr-1 animate-spin" />
													) : (
														<Brain className="h-4 w-4 mr-1" />
													)}
													Convert
												</Button>
											</TooltipTrigger>
											<TooltipContent>
												Convert to Knowledge Graph
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
							</div>
						</div>

						{/* Content */}
						<div className="flex-1 overflow-hidden p-3 bg-background">
							{loadingGraph ? (
								<div className="flex items-center justify-center h-full">
									<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
									<span className="ml-2 text-muted-foreground">
										Loading knowledge graph...
									</span>
								</div>
							) : (
								<D3KnowledgeGraph
									selectedPageId={selectedPage.id}
									graphData={graphData || undefined}
									width={800}
									height={600}
								/>
							)}
						</div>
					</div>
				) : (
					<div className="h-full overflow-hidden p-3 bg-background">
						<D3KnowledgeGraph width={800} height={600} />
					</div>
				)}
			</div>
		</div>
	);
};
