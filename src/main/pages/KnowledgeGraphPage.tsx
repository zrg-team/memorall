import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
	Search,
	Brain,
	Network,
	Plus,
	MoreHorizontal,
	Pencil,
	Trash2,
	Tags,
	Loader2,
	PanelLeftClose,
	PanelLeftOpen,
	BookOpenText,
	FileSearch,
	History,
	FolderInput,
} from "lucide-react";
import { eq, sql, or } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import NiceModal from "@ebay/nice-modal-react";

import { ScrollArea } from "@/main/components/ui/scroll-area";
import { Input } from "@/main/components/ui/input";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { PageHeader } from "@/main/components/ui/page-header";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import { useResponsiveWorkspacePanels } from "@/main/hooks/use-responsive-workspace-panels";
import { WorkspaceCollapsedSidebarDataItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarDataItem";
import { WorkspaceCollapsedSidebarItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarItem";
import { WorkspaceCollapsedSidebarSection } from "@/main/components/molecules/WorkspaceCollapsedSidebarSection";

import { D3KnowledgeGraph } from "@/main/modules/knowledge/components/D3KnowledgeGraph";
import {
	CreateTopicDialog,
	EditTopicDialog,
} from "@/main/modules/topics/modals";
import { topicService } from "@/main/modules/topics/services/topic-service";
import type { Topic } from "@/services/database/entities/topics";
import type {
	GrowType,
	RecallType,
} from "@/services/database/entities/topic-types";
import type { Node, Edge } from "@/services/database/types";
import { serviceManager } from "@/services";
import { logError, logInfo } from "@/utils/logger";

type TopicWithCount = Topic & { fileCount: number };

const DEFAULT_TOPIC_ID = "default" as const;
const PANEL_STORAGE_KEY = "memorall.knowledge.workspace-panels.v2";

const GROW_LABELS: Record<GrowType, string> = {
	"knowledge-graph": "Semantic Graph",
	structmem: "StructMem",
};

const RECALL_LABELS: Record<RecallType, string> = {
	smart: "Smart",
	quick: "Quick",
	llm: "LLM",
	structmem: "StructMem",
};

// ---------------------------------------------------------------------------
// TopicRow – clickable sidebar row for selecting / managing a topic
// ---------------------------------------------------------------------------

interface TopicRowProps {
	name: string;
	fileCount?: number;
	growType?: GrowType;
	recallType?: RecallType;
	isSelected: boolean;
	isDefault?: boolean;
	isDeleting?: boolean;
	onSelect: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
}

const TopicRow: React.FC<TopicRowProps> = ({
	name,
	fileCount,
	growType,
	recallType,
	isSelected,
	isDefault = false,
	isDeleting = false,
	onSelect,
	onEdit,
	onDelete,
}) => {
	const { t } = useTranslation("topics");

	return (
		<div
			className={`group flex items-center gap-1 px-3 py-1.5 cursor-pointer transition-colors hover:bg-muted/50 ${
				isSelected ? "bg-accent border-r-2 border-primary" : ""
			}`}
			onClick={onSelect}
		>
			<div className="flex-1 min-w-0 flex items-center gap-2">
				<span
					className={`text-sm truncate ${
						isSelected ? "font-medium text-foreground" : "text-muted-foreground"
					}`}
				>
					{name}
				</span>
				{typeof fileCount === "number" && !isDefault && (
					<Badge
						variant="secondary"
						className="text-xs shrink-0 h-4 px-1.5 py-0 leading-none"
					>
						{fileCount}
					</Badge>
				)}
				{growType && recallType && !isDefault && (
					<div className="flex items-center gap-1 shrink-0">
						<Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
							{GROW_LABELS[growType]}
						</Badge>
						<Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
							{RECALL_LABELS[recallType]}
						</Badge>
					</div>
				)}
			</div>

			{!isDefault && (onEdit || onDelete) && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
							disabled={isDeleting}
						>
							{isDeleting ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<MoreHorizontal className="h-3 w-3" />
							)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-32">
						{onEdit && (
							<DropdownMenuItem
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
							>
								<Pencil className="h-3.5 w-3.5 mr-2" />
								{t("manage.edit")}
							</DropdownMenuItem>
						)}
						{onDelete && (
							<DropdownMenuItem
								onClick={(e) => {
									e.stopPropagation();
									onDelete();
								}}
								className="text-destructive focus:text-destructive"
							>
								<Trash2 className="h-3.5 w-3.5 mr-2" />
								{t("manage.delete")}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
};

const StatCard: React.FC<{
	icon: React.ReactNode;
	label: string;
	value: number | string;
	description: string;
}> = ({ icon, label, value, description }) => (
	<div className="rounded-lg border border-border/70 bg-card px-4 py-3">
		<div className="flex items-center justify-between gap-3">
			<div className="min-w-0">
				<p className="text-xs font-medium text-muted-foreground">{label}</p>
				<p className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
					{value}
				</p>
			</div>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
				{icon}
			</div>
		</div>
		<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
			{description}
		</p>
	</div>
);

const MemoryEmptyState: React.FC<{
	icon: React.ReactNode;
	title: string;
	description: string;
	action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
	<div className="flex min-h-[220px] items-center justify-center px-6 py-10 text-center">
		<div className="max-w-sm">
			<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground">
				{icon}
			</div>
			<p className="text-base font-medium text-foreground">{title}</p>
			<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
				{description}
			</p>
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	</div>
);

const SectionHeader: React.FC<{
	title: string;
	description: string;
	action?: React.ReactNode;
}> = ({ title, description, action }) => (
	<div className="flex flex-wrap items-start justify-between gap-3">
		<div className="min-w-0">
			<h2 className="text-sm font-semibold text-foreground">{title}</h2>
			<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
				{description}
			</p>
		</div>
		{action ? <div className="shrink-0">{action}</div> : null}
	</div>
);

// ---------------------------------------------------------------------------
// KnowledgeGraphPage
// ---------------------------------------------------------------------------

interface KnowledgeGraphPageProps {}

export const KnowledgeGraphPage: React.FC<KnowledgeGraphPageProps> = () => {
	const { t } = useTranslation("knowledge");
	const navigate = useNavigate();
	const { t: tTopics } = useTranslation("topics");
	const [searchParams, setSearchParams] = useSearchParams();

	const [nodes, setNodes] = useState<Node[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = React.useRef<HTMLInputElement | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	// Topics state
	const [topics, setTopics] = useState<TopicWithCount[]>([]);
	const [selectedTopicId, setSelectedTopicId] =
		useState<string>(DEFAULT_TOPIC_ID);
	const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState("overview");
	const {
		collapseSidebar,
		containerRef,
		expandSidebar,
		gridTemplateColumns,
		handleResizeStart,
		isCompactSplitLayout,
		isSidebarCollapsed,
		isSplitLayout: isDesktop,
		sidebarOverlayWidth,
	} = useResponsiveWorkspacePanels({ storageKey: PANEL_STORAGE_KEY });

	useEffect(() => {
		loadTopics();
	}, []);

	useEffect(() => {
		const topicId = searchParams.get("topicId");
		if (topicId) {
			setSelectedTopicId(topicId);
			setSelectedNodeId(null);
		}
	}, [searchParams]);

	useEffect(() => {
		loadGraphData();
	}, [selectedTopicId]);

	const loadTopics = async () => {
		try {
			const data = await topicService.getTopicsWithContentCount();
			setTopics(data);
		} catch (error) {
			logError("Failed to load topics:", error);
		}
	};

	const loadGraphData = async () => {
		try {
			setLoading(true);
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const graphFilter =
					selectedTopicId === DEFAULT_TOPIC_ID
						? DEFAULT_TOPIC_ID
						: selectedTopicId;

				logInfo("[KNOWLEDGE_GRAPH] Loading graph data:", {
					selectedTopicId,
					graphFilter,
					isDefault: selectedTopicId === DEFAULT_TOPIC_ID,
				});

				const filteredNodes =
					selectedTopicId === DEFAULT_TOPIC_ID
						? await db
								.select()
								.from(schema.nodes)
								.where(
									or(
										eq(schema.nodes.graph, DEFAULT_TOPIC_ID),
										sql`${schema.nodes.graph} IS NULL`,
									),
								)
						: await db
								.select()
								.from(schema.nodes)
								.where(eq(schema.nodes.graph, graphFilter));

				const filteredEdges =
					selectedTopicId === DEFAULT_TOPIC_ID
						? await db
								.select()
								.from(schema.edges)
								.where(
									or(
										eq(schema.edges.graph, DEFAULT_TOPIC_ID),
										sql`${schema.edges.graph} IS NULL`,
									),
								)
						: await db
								.select()
								.from(schema.edges)
								.where(eq(schema.edges.graph, graphFilter));

				logInfo("[KNOWLEDGE_GRAPH] Query results:", {
					nodesCount: filteredNodes.length,
					edgesCount: filteredEdges.length,
				});

				setNodes(filteredNodes);
				setEdges(filteredEdges);
			});
		} catch (error) {
			logError("Failed to load knowledge graph data:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleNodeDeleted = () => {
		loadGraphData();
		setSelectedNodeId(null);
	};

	const handleEdgeDeleted = async (edgeId: string) => {
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db.delete(schema.edges).where(eq(schema.edges.id, edgeId));
			});
			await loadGraphData();
		} catch (error) {
			logError("Failed to delete edge:", error);
		}
	};

	const handleCreateTopic = async () => {
		const newTopic = await NiceModal.show(CreateTopicDialog);
		if (newTopic) {
			await loadTopics();
			logInfo("[KNOWLEDGE_GRAPH] Topic created:", newTopic);
		}
	};

	const handleEditTopic = async (topic: TopicWithCount) => {
		const result = await NiceModal.show(EditTopicDialog, { topic });
		if (result) {
			await loadTopics();
			logInfo("[KNOWLEDGE_GRAPH] Topic updated:", result);
		}
	};

	const handleDeleteTopic = async (topic: TopicWithCount) => {
		if (!confirm(t("topics.deleteConfirm", { name: topic.name }))) return;

		try {
			setDeletingTopicId(topic.id);
			await topicService.deleteTopic(topic.id);

			// Reset graph to default when the selected topic is deleted
			if (selectedTopicId === topic.id) {
				setSelectedTopicId(DEFAULT_TOPIC_ID);
			}

			await loadTopics();
			logInfo("[KNOWLEDGE_GRAPH] Topic deleted:", topic.id);
		} catch (error) {
			logError("[KNOWLEDGE_GRAPH] Failed to delete topic:", error);
		} finally {
			setDeletingTopicId(null);
		}
	};

	const handleTopicSelect = (topicId: string) => {
		setSelectedTopicId(topicId);
		setSelectedNodeId(null);
		setSearchParams(topicId === DEFAULT_TOPIC_ID ? {} : { topicId });
	};

	const filteredNodes = nodes.filter((node) =>
		node.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);
	const recentActivityItems = [
		`${nodes.length} semantic nodes available`,
		`${edges.length} semantic relationships available`,
	].filter(Boolean);
	const renderSemanticGraphView = () => (
		<div className="h-full overflow-hidden">
			{loading ? (
				<div className="flex h-full items-center justify-center text-muted-foreground">
					<div className="text-center">
						<Network className="mx-auto mb-4 h-12 w-12 animate-pulse text-muted-foreground/50" />
						<p className="text-lg font-medium">{t("loading")}</p>
					</div>
				</div>
			) : nodes.length === 0 ? (
				<MemoryEmptyState
					icon={<Network className="h-5 w-5" />}
					title={t("empty.title")}
					description={t("empty.description")}
					action={
						<div className="flex justify-center gap-2">
							<Button onClick={() => navigate("/files")}>
								<Plus className="h-4 w-4" />
								{t("empty.action")}
							</Button>
							<Button variant="outline" onClick={handleCreateTopic}>
								Create memory space
							</Button>
						</div>
					}
				/>
			) : (
				<div className="h-full">
					<D3KnowledgeGraph
						graphData={{ nodes, edges }}
						selectedNodeId={selectedNodeId || undefined}
						onNodeDeleted={handleNodeDeleted}
						onEdgeDeleted={handleEdgeDeleted}
						onNodeSelect={setSelectedNodeId}
					/>
				</div>
			)}
		</div>
	);

	return (
		<div
			ref={containerRef}
			className={
				isDesktop
					? "relative grid h-full overflow-hidden bg-background"
					: "flex h-full flex-col overflow-hidden bg-background"
			}
			style={
				isDesktop
					? {
							gridTemplateColumns,
						}
					: undefined
			}
		>
			{/* ----------------------------------------------------------------
			    Sidebar – visible on sm+ screens
			    ---------------------------------------------------------------- */}
			<div
				className={
					isDesktop
						? `relative z-20 flex min-h-0 flex-col border-r bg-background ${
								(isCompactSplitLayout && !isSidebarCollapsed) ||
								isSidebarCollapsed
									? "overflow-visible"
									: "overflow-hidden"
							}`
						: "hidden"
				}
			>
				{isSidebarCollapsed ? (
					<div className="flex h-full min-h-0 flex-col items-center py-3">
						<section
							aria-label="Actions"
							className="flex w-full flex-col items-center gap-1"
						>
							<WorkspaceCollapsedSidebarSection label="Actions" />
							<WorkspaceCollapsedSidebarItem
								icon={<PanelLeftOpen className="h-4 w-4" />}
								label={t("sidebar.show")}
								onClick={expandSidebar}
								className="border border-input bg-background hover:bg-accent"
							/>
							<WorkspaceCollapsedSidebarItem
								icon={<Plus className="h-4 w-4" />}
								label={tTopics("manage.newTopic")}
								onClick={() => void handleCreateTopic()}
								className="border border-dashed border-input hover:bg-muted/60"
							/>
						</section>
						<section
							aria-label="Lists"
							className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center"
						>
							<WorkspaceCollapsedSidebarSection label="Lists" />
							<div className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
								<WorkspaceCollapsedSidebarDataItem
									label={t("topic.defaultNoTopic")}
									badge={topics.length + 1}
									active={selectedTopicId === DEFAULT_TOPIC_ID}
									description={`${nodes.length} nodes`}
									onClick={() => handleTopicSelect(DEFAULT_TOPIC_ID)}
								/>
								{topics.map((topic) => (
									<WorkspaceCollapsedSidebarDataItem
										key={topic.id}
										label={topic.name}
										badge={topic.fileCount}
										active={selectedTopicId === topic.id}
										onClick={() => handleTopicSelect(topic.id)}
									/>
								))}
								<div className="my-1 w-6 border-t" />
								{filteredNodes.map((node) => (
									<WorkspaceCollapsedSidebarDataItem
										key={node.id}
										label={node.name}
										description={node.nodeType}
										active={selectedNodeId === node.id}
										onClick={() => setSelectedNodeId(node.id)}
									/>
								))}
							</div>
						</section>
					</div>
				) : (
					<div
						className={
							isCompactSplitLayout
								? "absolute left-0 top-0 flex h-full min-h-0 flex-col overflow-hidden border-r bg-background shadow-2xl"
								: "contents"
						}
						style={
							isCompactSplitLayout ? { width: sidebarOverlayWidth } : undefined
						}
					>
						<PageHeader
							icon={<Brain size={20} />}
							title={t("title")}
							description={t("description")}
							actionsPlacement="bottom"
							collapseButton={
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="h-8 w-8"
									onClick={() => {
										collapseSidebar();
									}}
									aria-label={t("sidebar.hide")}
									title={t("sidebar.hide")}
								>
									<PanelLeftClose className="h-4 w-4" />
								</Button>
							}
							actions={
								<Button
									type="button"
									size="sm"
									onClick={handleCreateTopic}
									className="h-8 shrink-0 px-3 text-xs"
								>
									<Plus size={13} className="mr-1" />
									{tTopics("manage.newTopic")}
								</Button>
							}
						/>

						{/* Topics Panel */}
						<div className="flex-shrink-0 border-b border-border">
							{/* Header */}
							<div className="flex items-center gap-1.5 px-3 py-2">
								<div className="flex items-center gap-1.5">
									<Tags className="h-3.5 w-3.5 text-muted-foreground" />
									<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
										{t("topics.title")}
									</span>
								</div>
							</div>

							{/* Topic list – scrollable up to ~6 rows */}
							<div className="overflow-y-auto max-h-48 py-1">
								<TopicRow
									name={t("topic.defaultNoTopic")}
									isSelected={selectedTopicId === DEFAULT_TOPIC_ID}
									isDefault
									onSelect={() => handleTopicSelect(DEFAULT_TOPIC_ID)}
								/>
								{topics.map((topic) => (
									<TopicRow
										key={topic.id}
										name={topic.name}
										fileCount={topic.fileCount}
										growType={topic.growType}
										recallType={topic.recallType}
										isSelected={selectedTopicId === topic.id}
										isDeleting={deletingTopicId === topic.id}
										onSelect={() => handleTopicSelect(topic.id)}
										onEdit={() => handleEditTopic(topic)}
										onDelete={() => handleDeleteTopic(topic)}
									/>
								))}
								{topics.length === 0 && (
									<p className="px-3 py-2 text-xs text-muted-foreground">
										{t("topics.noTopics")}
									</p>
								)}
							</div>
						</div>

						{/* Knowledge Nodes Panel */}
						<div className="flex-1 flex flex-col min-h-0">
							<div className="p-3 border-b border-border flex-shrink-0">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										ref={searchInputRef}
										placeholder={t("search.placeholder")}
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="pl-10"
									/>
								</div>
								<div className="text-xs text-muted-foreground mt-2">
									{t("search.nodeCount", {
										filtered: filteredNodes.length,
										total: nodes.length,
									})}
								</div>
							</div>

							<ScrollArea className="flex-1">
								{loading ? (
									<div className="p-3 text-center text-muted-foreground text-sm">
										{t("status.loading")}
									</div>
								) : filteredNodes.length === 0 ? (
									<div className="p-3 text-center text-muted-foreground text-sm">
										{searchQuery ? t("search.noMatches") : t("search.noNodes")}
									</div>
								) : (
									<div className="divide-y divide-border">
										{filteredNodes.map((node) => (
											<div
												key={node.id}
												className={`p-2 cursor-pointer hover:bg-muted/50 ${
													selectedNodeId === node.id
														? "bg-accent border-r-2 border-primary"
														: ""
												}`}
												onClick={() => setSelectedNodeId(node.id)}
											>
												<div className="flex items-center justify-between gap-2">
													<span className="font-medium text-sm line-clamp-1 text-foreground flex-1">
														{node.name}
													</span>
													<Badge
														variant="secondary"
														className="text-xs shrink-0"
													>
														{node.nodeType}
													</Badge>
												</div>
											</div>
										))}
									</div>
								)}
							</ScrollArea>
						</div>
					</div>
				)}
			</div>

			<div
				role="separator"
				aria-orientation="vertical"
				className={
					isDesktop && !isSidebarCollapsed && !isCompactSplitLayout
						? "group relative z-10 -mx-[5px] flex w-3 cursor-col-resize items-center justify-center bg-transparent"
						: "hidden"
				}
				onMouseDown={handleResizeStart}
			>
				<div className="h-full w-px bg-border/80 transition-all group-hover:w-[2px] group-hover:bg-foreground/20" />
			</div>

			{/* ----------------------------------------------------------------
			    Main memory hub
			    ---------------------------------------------------------------- */}
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<PageHeader
					icon={<Brain size={20} />}
					title={t("title")}
					description={t("description")}
					actionsPlacement="title"
					actions={
						<Button
							type="button"
							size="sm"
							onClick={handleCreateTopic}
							className="h-7 shrink-0 px-2.5 text-xs"
						>
							<Plus size={13} className="mr-1" />
							{tTopics("manage.newTopic")}
						</Button>
					}
					className={isDesktop ? "hidden" : ""}
				/>
				{/* Mobile bar – topic selector (<sm) */}
				<div
					className={
						isDesktop
							? "hidden"
							: "flex items-center border-b border-border bg-card p-3"
					}
				>
					<Select value={selectedTopicId} onValueChange={handleTopicSelect}>
						<SelectTrigger className="flex-1">
							<SelectValue placeholder={t("topic.selectPlaceholder")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={DEFAULT_TOPIC_ID}>
								{t("topic.defaultNoTopic")}
							</SelectItem>
							{topics.map((topic) => (
								<SelectItem key={topic.id} value={topic.id}>
									{topic.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<Tabs
					value={activeTab}
					onValueChange={setActiveTab}
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
				>
					<div className="border-b border-border px-4 py-3">
						<TabsList className="h-9 max-w-full justify-start overflow-x-auto">
							<TabsTrigger value="overview" className="gap-1.5 px-3 text-xs">
								<BookOpenText className="h-3.5 w-3.5" />
								Overview
							</TabsTrigger>
							<TabsTrigger value="semantic" className="gap-1.5 px-3 text-xs">
								<Network className="h-3.5 w-3.5" />
								Semantic
							</TabsTrigger>
							<TabsTrigger value="sources" className="gap-1.5 px-3 text-xs">
								<FileSearch className="h-3.5 w-3.5" />
								Sources
							</TabsTrigger>
							<TabsTrigger value="activity" className="gap-1.5 px-3 text-xs">
								<History className="h-3.5 w-3.5" />
								Activity
							</TabsTrigger>
						</TabsList>
					</div>

					<TabsContent
						value="overview"
						className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
					>
						<div className="space-y-5">
							<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
								<StatCard
									icon={<Network className="h-4 w-4" />}
									label="Semantic nodes"
									value={loading ? "..." : nodes.length}
									description="Entities, topics, and facts in the selected memory space."
								/>
								<StatCard
									icon={<Tags className="h-4 w-4" />}
									label="Memory spaces"
									value={topics.length + 1}
									description="Default memory plus curated semantic spaces."
								/>
								<StatCard
									icon={<FileSearch className="h-4 w-4" />}
									label="Pending sources"
									value={0}
									description="Files or chats waiting for memory review."
								/>
							</div>

							<div className="grid min-h-[320px] gap-4">
								<div className="flex min-h-[320px] flex-col rounded-lg border border-border/70 bg-card">
									<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
										<div>
											<h2 className="text-sm font-semibold text-foreground">
												Semantic memory
											</h2>
											<p className="text-xs text-muted-foreground">
												Graph view of facts and relationships.
											</p>
										</div>
										<Button
											size="sm"
											variant="outline"
											className="h-8"
											onClick={() => setActiveTab("semantic")}
										>
											Open graph
										</Button>
									</div>
									<div className="min-h-0 flex-1">
										{renderSemanticGraphView()}
									</div>
								</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent
						value="semantic"
						className="mt-0 min-h-0 flex-1 overflow-hidden"
					>
						{renderSemanticGraphView()}
					</TabsContent>

					<TabsContent
						value="sources"
						className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
					>
						<SectionHeader
							title="Sources"
							description="Files, chats, and conversions that can produce semantic memory."
							action={
								<Button size="sm" onClick={() => navigate("/files")}>
									<FolderInput className="mr-1.5 h-3.5 w-3.5" />
									Add sources
								</Button>
							}
						/>
						<MemoryEmptyState
							icon={<FileSearch className="h-5 w-5" />}
							title="No pending sources"
							description="Drop or choose files from Files to build memory from source material."
							action={
								<Button variant="outline" onClick={() => navigate("/files")}>
									Open Files
								</Button>
							}
						/>
					</TabsContent>

					<TabsContent
						value="activity"
						className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
					>
						<SectionHeader
							title="Activity"
							description="Recent semantic memory changes."
						/>
						<div className="mt-4 rounded-lg border border-border/70 bg-card">
							{recentActivityItems.map((item, index) => (
								<div
									key={item}
									className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
								>
									<div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
										<History className="h-3.5 w-3.5" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-sm text-foreground">{item}</p>
										<p className="text-xs text-muted-foreground">
											{index === 0
												? "Current semantic state"
												: "Current memory state"}
										</p>
									</div>
								</div>
							))}
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
};
