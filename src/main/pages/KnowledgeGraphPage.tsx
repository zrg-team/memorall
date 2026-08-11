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
	Workflow,
	FileSearch,
	History,
	Github,
	Eye,
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
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/main/components/ui/alert-dialog";
import { PageHeader } from "@/main/components/ui/page-header";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import { useResponsiveWorkspacePanels } from "@/main/hooks/use-responsive-workspace-panels";
import { WorkspaceCollapsedSidebarDataItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarDataItem";

import { D3KnowledgeGraph } from "@/main/modules/knowledge/components/D3KnowledgeGraph";
import {
	GithubImportDialog,
	SkillCategoryBadge,
	SkillEditorDialog,
	SkillPreviewDialog,
} from "@/main/modules/agents/components/SkillsSection";
import { useAgentConfigStore } from "@/main/stores/agent-config";
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
import {
	skillFileSystemService,
	type SkillSummary,
} from "@/services/filesystem/skill-filesystem";
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

const useProceduralSkills = () => {
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [loading, setLoading] = useState(true);

	const loadSkills = React.useCallback(async () => {
		setLoading(true);
		try {
			setSkills(await skillFileSystemService.listSkills());
		} catch (error) {
			logError("Failed to load procedural memory skills:", error);
			setSkills([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSkills();
	}, [loadSkills]);

	return { skills, loading, loadSkills };
};

const ProceduralMemoryPanel: React.FC<{
	skills: SkillSummary[];
	loading: boolean;
	onSkillsChanged: () => Promise<void>;
}> = ({ skills, loading, onSkillsChanged }) => {
	const enabledSkillNames = useAgentConfigStore(
		(state) => state.draftEnabledSkillNames,
	);
	const enabledSkillNameSet = React.useMemo(
		() => new Set(enabledSkillNames),
		[enabledSkillNames],
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorInitial, setEditorInitial] = useState<
		{ name: string; description: string; body: string } | undefined
	>(undefined);
	const [importOpen, setImportOpen] = useState(false);
	const [previewSkill, setPreviewSkill] = useState<SkillSummary | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

	const filteredSkills = React.useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		return skills
			.filter((skill) => {
				if (!query) return true;
				return [
					skill.name,
					skill.description,
					skill.collection,
					skill.publisher,
				]
					.filter(Boolean)
					.some((value) => value!.toLowerCase().includes(query));
			})
			.sort((a, b) => {
				const aEnabled = enabledSkillNameSet.has(a.name);
				const bEnabled = enabledSkillNameSet.has(b.name);
				if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
				if (a.origin !== b.origin) return a.origin === "custom" ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
	}, [enabledSkillNameSet, searchQuery, skills]);

	const handleOpenCreate = () => {
		setEditorInitial(undefined);
		setEditorOpen(true);
	};

	const handleOpenEdit = async (skill: SkillSummary) => {
		const full = await skillFileSystemService.readSkill(skill.name);
		setEditorInitial({
			name: full.name,
			description: full.description,
			body: full.body,
		});
		setEditorOpen(true);
	};

	const handleSave = async (
		name: string,
		description: string,
		body: string,
	) => {
		await skillFileSystemService.writeSkill(name, description, body);
		await onSkillsChanged();
	};

	const handleImport = async (url: string) => {
		await skillFileSystemService.importFromGithub(url);
		await onSkillsChanged();
	};

	const handleDelete = async (name: string) => {
		await skillFileSystemService.deleteSkill(name);
		setDeleteTarget(null);
		await onSkillsChanged();
	};

	return (
		<>
			<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4">
				<SectionHeader
					title="Skills"
					description="Procedural memory stores reusable workflows, triggers, and instructions agents can apply later."
					action={
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-8"
								onClick={() => setImportOpen(true)}
							>
								<Github className="mr-1.5 h-3.5 w-3.5" />
								Import skill
							</Button>
							<Button
								type="button"
								size="sm"
								className="h-8"
								onClick={handleOpenCreate}
							>
								<Plus className="mr-1.5 h-3.5 w-3.5" />
								Create skill
							</Button>
						</div>
					}
				/>
				<div className="relative">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search skills, triggers, or collections..."
						className="h-9 pl-9"
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading ? (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading skills...
						</div>
					) : filteredSkills.length === 0 ? (
						<MemoryEmptyState
							icon={<Workflow className="h-5 w-5" />}
							title="No procedural memory yet"
							description="Create or import a skill to preserve a reusable workflow."
							action={
								<div className="flex justify-center gap-2">
									<Button size="sm" onClick={handleOpenCreate}>
										Create skill
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setImportOpen(true)}
									>
										Import skill
									</Button>
								</div>
							}
						/>
					) : (
						<div className="grid gap-3 lg:grid-cols-2">
							{filteredSkills.map((skill) => {
								const enabled = enabledSkillNameSet.has(skill.name);
								const canEdit = skill.origin !== "default" && !skill.readOnly;
								return (
									<div
										key={skill.name}
										className="flex min-h-[132px] flex-col rounded-lg border border-border/70 bg-card p-4"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0 space-y-2">
												<div className="flex flex-wrap items-center gap-2">
													<span className="truncate font-mono text-sm font-semibold text-foreground">
														{skill.name}
													</span>
													<Badge
														variant={
															skill.origin === "custom"
																? "default"
																: "secondary"
														}
														className="h-5"
													>
														{skill.origin === "custom" ? "Custom" : "Default"}
													</Badge>
													{enabled ? (
														<Badge variant="outline" className="h-5">
															Enabled in draft
														</Badge>
													) : null}
													{skill.collection ? (
														<SkillCategoryBadge collection={skill.collection} />
													) : null}
												</div>
												<p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
													{skill.description || "No trigger description yet."}
												</p>
											</div>
										</div>
										<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
											<p className="text-[11px] text-muted-foreground">
												{skill.publisher ??
													skill.repo ??
													"Local procedural memory"}
											</p>
											<div className="flex items-center gap-1">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs"
													onClick={() => setPreviewSkill(skill)}
												>
													<Eye className="mr-1 h-3.5 w-3.5" />
													Preview
												</Button>
												{canEdit ? (
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="h-7 px-2 text-xs"
														onClick={() => void handleOpenEdit(skill)}
													>
														<Pencil className="mr-1 h-3.5 w-3.5" />
														Edit
													</Button>
												) : null}
												{canEdit ? (
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
														onClick={() => setDeleteTarget(skill.name)}
													>
														<Trash2 className="h-3.5 w-3.5" />
													</Button>
												) : null}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			<SkillEditorDialog
				open={editorOpen}
				onOpenChange={setEditorOpen}
				initial={editorInitial}
				onSave={handleSave}
			/>
			<GithubImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				onImport={handleImport}
			/>
			<SkillPreviewDialog
				open={previewSkill !== null}
				onOpenChange={(open) => {
					if (!open) setPreviewSkill(null);
				}}
				skill={previewSkill}
			/>
			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete procedural memory?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes the custom skill "{deleteTarget}". Default skills
							cannot be deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => deleteTarget && void handleDelete(deleteTarget)}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};

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
	const { skills, loading: skillsLoading, loadSkills } = useProceduralSkills();
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
	const customSkillCount = skills.filter(
		(skill) => skill.origin === "custom",
	).length;
	const defaultSkillCount = Math.max(skills.length - customSkillCount, 0);
	const recentActivityItems = [
		`${nodes.length} semantic nodes available`,
		`${edges.length} semantic relationships available`,
		`${skills.length} procedural skills available`,
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
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="h-10 w-10 shrink-0"
							onClick={expandSidebar}
							aria-label={t("sidebar.show")}
							title={t("sidebar.show")}
						>
							<PanelLeftOpen className="h-4 w-4" />
						</Button>
						<div className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
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
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="mt-3 h-10 w-10 shrink-0 border-dashed"
							onClick={() => void handleCreateTopic()}
							aria-label={tTopics("manage.newTopic")}
							title={tTopics("manage.newTopic")}
						>
							<Plus className="h-4 w-4" />
						</Button>
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
							<TabsTrigger value="procedural" className="gap-1.5 px-3 text-xs">
								<Workflow className="h-3.5 w-3.5" />
								Procedural
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
							<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
									icon={<Workflow className="h-4 w-4" />}
									label="Procedural skills"
									value={skillsLoading ? "..." : skills.length}
									description="Reusable workflows available to agents."
								/>
								<StatCard
									icon={<FileSearch className="h-4 w-4" />}
									label="Pending sources"
									value={0}
									description="Files or chats waiting for memory review."
								/>
							</div>

							<div className="grid min-h-[320px] gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
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

								<div className="flex min-h-[320px] flex-col rounded-lg border border-border/70 bg-card">
									<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
										<div>
											<h2 className="text-sm font-semibold text-foreground">
												Procedural memory
											</h2>
											<p className="text-xs text-muted-foreground">
												Skills that preserve reusable workflows.
											</p>
										</div>
										<Button
											size="sm"
											variant="outline"
											className="h-8"
											onClick={() => setActiveTab("procedural")}
										>
											Manage skills
										</Button>
									</div>
									<div className="flex-1 overflow-y-auto p-4">
										{skillsLoading ? (
											<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Loading skills...
											</div>
										) : skills.length === 0 ? (
											<MemoryEmptyState
												icon={<Workflow className="h-5 w-5" />}
												title="No procedural memory yet"
												description="Create or import a skill to preserve a workflow."
												action={
													<Button
														size="sm"
														onClick={() => setActiveTab("procedural")}
													>
														Create skill
													</Button>
												}
											/>
										) : (
											<div className="space-y-2">
												<div className="grid grid-cols-2 gap-2">
													<StatCard
														icon={<Workflow className="h-4 w-4" />}
														label="Custom"
														value={customSkillCount}
														description="User-authored workflows."
													/>
													<StatCard
														icon={<BookOpenText className="h-4 w-4" />}
														label="Default"
														value={defaultSkillCount}
														description="Bundled skills."
													/>
												</div>
												{skills.slice(0, 5).map((skill) => (
													<div
														key={skill.name}
														className="rounded-md border border-border/60 bg-muted/20 px-3 py-2"
													>
														<div className="flex items-center justify-between gap-2">
															<p className="truncate font-mono text-xs font-medium text-foreground">
																{skill.name}
															</p>
															<Badge
																variant="outline"
																className="h-5 text-[10px]"
															>
																{skill.origin === "custom"
																	? "Custom"
																	: "Default"}
															</Badge>
														</div>
														<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
															{skill.description ||
																"No trigger description yet."}
														</p>
													</div>
												))}
											</div>
										)}
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
						value="procedural"
						className="mt-0 min-h-0 flex-1 overflow-hidden"
					>
						<ProceduralMemoryPanel
							skills={skills}
							loading={skillsLoading}
							onSkillsChanged={loadSkills}
						/>
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
							description="Recent semantic and procedural memory changes."
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
