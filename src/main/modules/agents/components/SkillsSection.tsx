import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Github, Pencil, Plus, Trash2 } from "lucide-react";
import {
	skillFileSystemService,
	type Skill,
	type SkillSummary,
} from "@/services/filesystem/skill-filesystem";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import { Textarea } from "@/main/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
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
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import { cn } from "@/lib/utils";

interface SkillEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial?: { name: string; description: string; body: string };
	onSave: (name: string, description: string, body: string) => Promise<void>;
}

export const SkillEditorDialog: React.FC<SkillEditorDialogProps> = ({
	open,
	onOpenChange,
	initial,
	onSave,
}) => {
	const { t } = useTranslation(["agents", "common"]);
	const [name, setName] = useState(initial?.name ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [body, setBody] = useState(initial?.body ?? "");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const isEdit = initial !== undefined;

	useEffect(() => {
		if (open) {
			setName(initial?.name ?? "");
			setDescription(initial?.description ?? "");
			setBody(initial?.body ?? "");
			setError(null);
		}
	}, [open, initial?.name, initial?.description, initial?.body]);

	const handleSave = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError(t("skills.editor.nameRequired", { ns: "agents" }));
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSave(trimmedName, description.trim(), body.trim());
			onOpenChange(false);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("skills.editor.saveFailed", { ns: "agents" }),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isEdit
							? t("skills.editor.editTitle", { ns: "agents" })
							: t("skills.editor.newTitle", { ns: "agents" })}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label className="text-xs">
							{t("skills.editor.nameLabel", { ns: "agents" })}
						</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("skills.editor.namePlaceholder", { ns: "agents" })}
							disabled={isEdit}
							className="h-8 font-mono text-sm"
						/>
						<p className="text-[11px] text-muted-foreground">
							{t("skills.editor.nameHint", { ns: "agents" })}
						</p>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs">
							{t("skills.editor.descriptionLabel", { ns: "agents" })}
						</Label>
						<Input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("skills.editor.descriptionPlaceholder", {
								ns: "agents",
							})}
							className="h-8 text-sm"
						/>
					</div>
					<div className="space-y-1.5">
						<Label className="text-xs">
							{t("skills.editor.contentLabel", { ns: "agents" })}
						</Label>
						<Textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder={t("skills.editor.contentPlaceholder", {
								ns: "agents",
							})}
							className="min-h-[180px] resize-y font-mono text-xs"
						/>
					</div>
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
						disabled={saving}
					>
						{t("buttons.cancel", { ns: "common" })}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => void handleSave()}
						disabled={saving}
					>
						{saving
							? t("skills.editor.saving", { ns: "agents" })
							: t("buttons.save", { ns: "common" })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

interface GithubImportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onImport: (url: string) => Promise<void>;
}

export const GithubImportDialog: React.FC<GithubImportDialogProps> = ({
	open,
	onOpenChange,
	onImport,
}) => {
	const { t } = useTranslation(["agents", "common"]);
	const [url, setUrl] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);

	useEffect(() => {
		if (open) {
			setUrl("");
			setError(null);
		}
	}, [open]);

	const handleImport = async () => {
		const trimmed = url.trim();
		if (!trimmed) return;
		setImporting(true);
		setError(null);
		try {
			await onImport(trimmed);
			onOpenChange(false);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("skills.import.importFailed", { ns: "agents" }),
			);
		} finally {
			setImporting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Github size={16} />
						{t("skills.import.title", { ns: "agents" })}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label className="text-xs">
							{t("skills.import.urlLabel", { ns: "agents" })}
						</Label>
						<Input
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder={t("skills.import.urlPlaceholder", { ns: "agents" })}
							className="h-8 font-mono text-sm"
						/>
						<p className="text-[11px] text-muted-foreground">
							{t("skills.import.urlHint", { ns: "agents" })}
						</p>
					</div>
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
						disabled={importing}
					>
						{t("buttons.cancel", { ns: "common" })}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => void handleImport()}
						disabled={importing || !url.trim()}
					>
						{importing
							? t("skills.import.importing", { ns: "agents" })
							: t("buttons.import", { ns: "common" })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

interface SkillPreviewDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	skill: SkillSummary | null;
}

export const SkillPreviewDialog: React.FC<SkillPreviewDialogProps> = ({
	open,
	onOpenChange,
	skill,
}) => {
	const { t } = useTranslation(["agents", "common"]);
	const [loadedSkill, setLoadedSkill] = useState<Skill | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !skill) {
			setLoadedSkill(null);
			setLoading(false);
			setError(null);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);
		setLoadedSkill(null);

		void skillFileSystemService
			.readSkill(skill.name)
			.then((fullSkill) => {
				if (!cancelled) {
					setLoadedSkill(fullSkill);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setError(
						err instanceof Error
							? err.message
							: t("skills.preview.loadFailed", { ns: "agents" }),
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [open, skill, t]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[min(88dvh,900px)] w-[calc(100vw-1rem)] max-w-[960px] flex-col gap-0 overflow-hidden p-0 sm:w-[min(94vw,960px)]">
				<DialogHeader className="border-b px-5 pb-4 pt-5">
					<DialogTitle className="flex items-center justify-between gap-3">
						<span className="truncate font-mono text-sm">
							{skill?.name ?? t("skills.preview.title", { ns: "agents" })}
						</span>
						{skill?.origin === "default" ? (
							<Badge variant="secondary" className="shrink-0">
								{t("skills.preview.readOnly", { ns: "agents" })}
							</Badge>
						) : null}
					</DialogTitle>
				</DialogHeader>
				<div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
					{skill?.description ? (
						<p className="text-sm leading-relaxed text-muted-foreground">
							{skill.description}
						</p>
					) : null}

					{skill?.origin === "default" ? (
						<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
							{skill.publisher ? (
								<Badge variant="outline">{skill.publisher}</Badge>
							) : null}
							{skill.collection ? (
								<SkillCategoryBadge collection={skill.collection} />
							) : null}
							{skill.sourceUrl ? (
								<a
									href={skill.sourceUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
								>
									<ExternalLink size={12} />
									{t("skills.preview.source", { ns: "agents" })}
								</a>
							) : null}
						</div>
					) : null}

					{loading ? (
						<p className="text-sm text-muted-foreground">
							{t("skills.preview.loading", { ns: "agents" })}
						</p>
					) : error ? (
						<p className="text-sm text-destructive">{error}</p>
					) : (
						<pre className="overflow-x-auto rounded-2xl border border-border/60 bg-muted/25 p-4 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
							{loadedSkill?.body ?? ""}
						</pre>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};

interface ManageSkillsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultSkills: SkillSummary[];
	customSkills: SkillSummary[];
	enabledSkillNameSet: Set<string>;
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	categoryFilter: string;
	onCategoryFilterChange: (value: string) => void;
	onOpenCreate: () => void;
	onOpenEdit: (skill: SkillSummary) => void;
	onOpenPreview: (skill: SkillSummary) => void;
	onToggleSkill: (skillName: string) => void;
	onDelete: (name: string) => void;
	onImport: () => void;
}

const matchesSkillQuery = (skill: SkillSummary, query: string): boolean => {
	if (!query) return true;

	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return true;

	return [
		skill.name,
		skill.description,
		skill.publisher,
		skill.collection,
		skill.repo,
	]
		.filter(Boolean)
		.some((value) => value!.toLowerCase().includes(normalizedQuery));
};

const matchesSkillCategory = (
	skill: SkillSummary,
	categoryFilter: string,
): boolean => {
	if (categoryFilter === "all") return true;
	if (!skill.collection) return false;
	return (
		getSkillCategoryLabel(skill.collection).toLowerCase() === categoryFilter
	);
};

const orderEnabledSkillsFirst = (
	skills: SkillSummary[],
	enabledSkillNameSet: Set<string>,
): SkillSummary[] => {
	const enabled: SkillSummary[] = [];
	const disabled: SkillSummary[] = [];

	for (const skill of skills) {
		if (enabledSkillNameSet.has(skill.name)) {
			enabled.push(skill);
		} else {
			disabled.push(skill);
		}
	}

	return [...enabled, ...disabled];
};

const getSkillCategoryLabel = (collection: string): string => {
	const normalized = collection.trim().toLowerCase();
	if (normalized === "design-skills" || normalized.includes("open-design")) {
		return "design";
	}
	return collection;
};

const getSkillCategoryBadgeClassName = (collection: string): string => {
	const normalized = collection.trim().toLowerCase();

	if (normalized === "design-skills" || normalized.includes("open-design")) {
		return "border-cyan-400/35 bg-cyan-400/10 text-cyan-200";
	}
	if (normalized.includes("engineering")) {
		return "border-blue-400/35 bg-blue-400/10 text-blue-200";
	}
	if (normalized.includes("tooling")) {
		return "border-amber-400/35 bg-amber-400/10 text-amber-200";
	}
	if (normalized.includes("documentation")) {
		return "border-violet-400/35 bg-violet-400/10 text-violet-200";
	}
	if (normalized.includes("api")) {
		return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
	}
	if (normalized.includes("web")) {
		return "border-sky-400/35 bg-sky-400/10 text-sky-200";
	}
	if (normalized.includes("project")) {
		return "border-rose-400/35 bg-rose-400/10 text-rose-200";
	}
	if (normalized.includes("anthropic")) {
		return "border-orange-400/35 bg-orange-400/10 text-orange-200";
	}
	return "border-border/70 bg-muted/40 text-muted-foreground";
};

export const SkillCategoryBadge: React.FC<{ collection: string }> = ({
	collection,
}) => (
	<Badge
		variant="outline"
		className={cn("capitalize", getSkillCategoryBadgeClassName(collection))}
	>
		{getSkillCategoryLabel(collection)}
	</Badge>
);

const getSkillCategoryOptions = (skills: SkillSummary[]): string[] =>
	[
		...new Set(
			skills
				.map((skill) =>
					skill.collection
						? getSkillCategoryLabel(skill.collection).toLowerCase()
						: null,
				)
				.filter((category): category is string => Boolean(category)),
		),
	].sort((a, b) => a.localeCompare(b));

const ManageSkillsDialog: React.FC<ManageSkillsDialogProps> = ({
	open,
	onOpenChange,
	defaultSkills,
	customSkills,
	enabledSkillNameSet,
	searchQuery,
	onSearchQueryChange,
	categoryFilter,
	onCategoryFilterChange,
	onOpenCreate,
	onOpenEdit,
	onOpenPreview,
	onToggleSkill,
	onDelete,
	onImport,
}) => {
	const { t } = useTranslation(["agents", "common"]);
	const categoryOptions = useMemo(
		() => getSkillCategoryOptions([...defaultSkills, ...customSkills]),
		[defaultSkills, customSkills],
	);
	const filteredDefaultSkills = useMemo(
		() =>
			orderEnabledSkillsFirst(
				defaultSkills
					.filter((skill) => matchesSkillQuery(skill, searchQuery))
					.filter((skill) => matchesSkillCategory(skill, categoryFilter)),
				enabledSkillNameSet,
			),
		[categoryFilter, defaultSkills, enabledSkillNameSet, searchQuery],
	);
	const filteredCustomSkills = useMemo(
		() =>
			orderEnabledSkillsFirst(
				customSkills
					.filter((skill) => matchesSkillQuery(skill, searchQuery))
					.filter((skill) => matchesSkillCategory(skill, categoryFilter)),
				enabledSkillNameSet,
			),
		[categoryFilter, customSkills, enabledSkillNameSet, searchQuery],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[min(88dvh,820px)] w-[calc(100vw-1rem)] max-w-[920px] flex-col gap-0 overflow-hidden p-0 sm:w-[min(94vw,920px)]">
				<DialogHeader className="border-b px-5 pb-4 pt-5">
					<DialogTitle>{t("skills.manageTitle", { ns: "agents" })}</DialogTitle>
				</DialogHeader>

				<div className="border-b px-5 py-4">
					<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-center">
						<Input
							value={searchQuery}
							onChange={(event) => onSearchQueryChange(event.target.value)}
							placeholder={t("skills.searchPlaceholder", { ns: "agents" })}
							className="h-9"
						/>
						<Select
							value={categoryFilter}
							onValueChange={onCategoryFilterChange}
						>
							<SelectTrigger className="h-9">
								<SelectValue placeholder="All categories" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All categories</SelectItem>
								{categoryOptions.map((category) => (
									<SelectItem key={category} value={category}>
										<span className="capitalize">{category}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="secondary">
								{t("skills.defaultCount", {
									ns: "agents",
									count: defaultSkills.length,
								})}
							</Badge>
							<Badge variant="outline">
								{t("skills.customCount", {
									ns: "agents",
									count: customSkills.length,
								})}
							</Badge>
						</div>
					</div>
					<p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
						{t("skills.defaultHint", { ns: "agents" })}
					</p>
				</div>

				<Tabs defaultValue="default" className="flex min-h-0 flex-1 flex-col">
					<div className="px-5 pt-4">
						<TabsList className="grid h-9 w-full grid-cols-2">
							<TabsTrigger value="default" className="text-xs">
								{t("skills.defaultTab", { ns: "agents" })}
							</TabsTrigger>
							<TabsTrigger value="custom" className="text-xs">
								{t("skills.customTab", { ns: "agents" })}
							</TabsTrigger>
						</TabsList>
					</div>

					<TabsContent
						value="default"
						className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4"
					>
						<div className="space-y-2">
							{filteredDefaultSkills.length === 0 ? (
								<p className="py-8 text-center text-sm text-muted-foreground">
									{t("skills.emptyDefault", { ns: "agents" })}
								</p>
							) : (
								filteredDefaultSkills.map((skill) => (
									<div
										key={skill.name}
										className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/25 px-4 py-3"
									>
										<div className="min-w-0 flex-1 space-y-2">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-mono text-xs font-semibold">
													{skill.name}
												</span>
												{skill.publisher ? (
													<Badge variant="outline">{skill.publisher}</Badge>
												) : null}
												{skill.collection ? (
													<SkillCategoryBadge collection={skill.collection} />
												) : null}
											</div>
											<p className="text-xs leading-relaxed text-muted-foreground">
												{skill.description}
											</p>
										</div>
										<Button
											type="button"
											variant={
												enabledSkillNameSet.has(skill.name)
													? "secondary"
													: "default"
											}
											size="sm"
											className="shrink-0"
											onClick={() => onToggleSkill(skill.name)}
										>
											{enabledSkillNameSet.has(skill.name)
												? t("skills.disableAction", { ns: "agents" })
												: t("skills.enableAction", { ns: "agents" })}
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="shrink-0"
											onClick={() => onOpenPreview(skill)}
										>
											{t("skills.preview.action", { ns: "agents" })}
										</Button>
									</div>
								))
							)}
						</div>
					</TabsContent>

					<TabsContent
						value="custom"
						className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4"
					>
						<div className="space-y-2">
							{filteredCustomSkills.length === 0 ? (
								<p className="py-8 text-center text-sm text-muted-foreground">
									{customSkills.length === 0
										? t("skills.emptyCustom", { ns: "agents" })
										: t("skills.emptyFilteredCustom", { ns: "agents" })}
								</p>
							) : (
								filteredCustomSkills.map((skill) => (
									<div
										key={skill.name}
										className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-mono text-xs font-medium">
												{skill.name}
											</p>
											{skill.description ? (
												<p className="truncate text-[11px] text-muted-foreground">
													{skill.description}
												</p>
											) : null}
										</div>
										<div className="flex shrink-0 items-center gap-1">
											<Button
												type="button"
												variant={
													enabledSkillNameSet.has(skill.name)
														? "secondary"
														: "outline"
												}
												size="sm"
												className="h-7 px-2 text-[11px]"
												onClick={() => onToggleSkill(skill.name)}
											>
												{enabledSkillNameSet.has(skill.name)
													? t("skills.disableAction", { ns: "agents" })
													: t("skills.enableAction", { ns: "agents" })}
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
												onClick={() => onOpenEdit(skill)}
											>
												<Pencil size={11} />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
												onClick={() => onDelete(skill.name)}
											>
												<Trash2 size={11} />
											</Button>
										</div>
									</div>
								))
							)}
						</div>
					</TabsContent>
				</Tabs>

				<DialogFooter className="border-t px-5 py-4 sm:justify-between">
					<Button type="button" variant="outline" size="sm" onClick={onImport}>
						<Github size={12} className="mr-1.5" />
						{t("skills.import.title", { ns: "agents" })}
					</Button>
					<Button type="button" size="sm" onClick={onOpenCreate}>
						<Plus size={12} className="mr-1.5" />
						{t("skills.editor.newTitle", { ns: "agents" })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export const SkillsSection: React.FC = () => {
	const { t } = useTranslation(["agents", "common"]);
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const draftEnabledSkillNames = useAgentConfigStore(
		(state) => state.draftEnabledSkillNames,
	);
	const toggleSkill = useAgentConfigStore((state) => state.toggleSkill);

	const [manageOpen, setManageOpen] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorInitial, setEditorInitial] = useState<
		{ name: string; description: string; body: string } | undefined
	>(undefined);
	const [importOpen, setImportOpen] = useState(false);
	const [previewSkill, setPreviewSkill] = useState<SkillSummary | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [categoryFilter, setCategoryFilter] = useState("all");

	const loadSkills = useCallback(async () => {
		setLoading(true);
		try {
			setSkills(await skillFileSystemService.listSkills());
		} catch {
			setSkills([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSkills();
	}, [loadSkills]);

	const defaultSkills = useMemo(
		() => skills.filter((skill) => skill.origin === "default"),
		[skills],
	);
	const customSkills = useMemo(
		() =>
			skills
				.filter((skill) => skill.origin !== "default")
				.sort((a, b) => a.name.localeCompare(b.name)),
		[skills],
	);
	const enabledSkillNameSet = useMemo(
		() => new Set(draftEnabledSkillNames),
		[draftEnabledSkillNames],
	);
	const enabledSkills = useMemo(
		() =>
			skills
				.filter((skill) => enabledSkillNameSet.has(skill.name))
				.sort((a, b) => {
					if (a.origin !== b.origin) {
						return a.origin === "default" ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				}),
		[enabledSkillNameSet, skills],
	);
	const visibleEnabledSkills = enabledSkills.slice(0, 6);
	const hiddenSkillCount = Math.max(
		enabledSkills.length - visibleEnabledSkills.length,
		0,
	);

	const handleOpenCreate = () => {
		setEditorInitial(undefined);
		setManageOpen(false);
		setEditorOpen(true);
	};

	const handleOpenEdit = async (skill: SkillSummary) => {
		try {
			const full = await skillFileSystemService.readSkill(skill.name);
			setEditorInitial({
				name: full.name,
				description: full.description,
				body: full.body,
			});
			setManageOpen(false);
			setEditorOpen(true);
		} catch {
			// skill may have been deleted
		}
	};

	const handleOpenPreview = (skill: SkillSummary) => {
		setManageOpen(false);
		setPreviewSkill(skill);
	};

	const handleSave = async (
		name: string,
		description: string,
		body: string,
	) => {
		await skillFileSystemService.writeSkill(name, description, body);
		await loadSkills();
	};

	const handleImport = async (url: string) => {
		await skillFileSystemService.importFromGithub(url);
		await loadSkills();
	};

	const handleDelete = async (name: string) => {
		await skillFileSystemService.deleteSkill(name);
		setDeleteTarget(null);
		await loadSkills();
	};

	return (
		<>
			<CursorPoint
				cursorKey={AGENT_WIZARD_CURSOR_KEYS.skills}
				className="flex min-h-[32px] items-center gap-3"
			>
				<span
					className="w-20 shrink-0 text-sm text-muted-foreground"
					title={t("skills.memoryHint", { ns: "agents" })}
				>
					{t("skills.label", { ns: "agents" })}
				</span>

				<div className="flex flex-wrap items-center gap-1.5">
					{loading ? (
						<span className="text-[11px] text-muted-foreground/50">…</span>
					) : enabledSkills.length === 0 ? (
						<span className="text-[11px] text-muted-foreground">
							{t("skills.noneEnabled", { ns: "agents" })}
						</span>
					) : (
						<>
							{visibleEnabledSkills.map((skill) => (
								<button
									key={skill.name}
									type="button"
									onClick={() => setManageOpen(true)}
									className="flex items-center rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
								>
									{skill.name}
								</button>
							))}
							{hiddenSkillCount > 0 ? (
								<span className="rounded-lg border border-dashed border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
									+{hiddenSkillCount}
								</span>
							) : null}
						</>
					)}
					<button
						type="button"
						onClick={() => setManageOpen(true)}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						<Plus size={12} />
						{t("skills.manageAction", { ns: "agents" })}
					</button>
				</div>
			</CursorPoint>

			<ManageSkillsDialog
				open={manageOpen}
				onOpenChange={(open) => {
					setManageOpen(open);
					if (!open) {
						setSearchQuery("");
						setCategoryFilter("all");
					}
				}}
				defaultSkills={defaultSkills}
				customSkills={customSkills}
				enabledSkillNameSet={enabledSkillNameSet}
				searchQuery={searchQuery}
				onSearchQueryChange={setSearchQuery}
				categoryFilter={categoryFilter}
				onCategoryFilterChange={setCategoryFilter}
				onOpenCreate={handleOpenCreate}
				onOpenEdit={(skill) => void handleOpenEdit(skill)}
				onOpenPreview={handleOpenPreview}
				onToggleSkill={toggleSkill}
				onDelete={(name) => setDeleteTarget(name)}
				onImport={() => {
					setManageOpen(false);
					setImportOpen(true);
				}}
			/>

			<SkillEditorDialog
				open={editorOpen}
				onOpenChange={(open) => {
					setEditorOpen(open);
					if (!open) setManageOpen(true);
				}}
				initial={editorInitial}
				onSave={handleSave}
			/>

			<GithubImportDialog
				open={importOpen}
				onOpenChange={(open) => {
					setImportOpen(open);
					if (!open) setManageOpen(true);
				}}
				onImport={handleImport}
			/>

			<SkillPreviewDialog
				open={previewSkill !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPreviewSkill(null);
						setManageOpen(true);
					}
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
						<AlertDialogTitle>
							{t("skills.delete.title", { ns: "agents" })}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("skills.delete.description", {
								ns: "agents",
								name: deleteTarget,
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{t("buttons.cancel", { ns: "common" })}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && void handleDelete(deleteTarget)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("skills.delete.confirm", { ns: "agents" })}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
