import React from "react";
import { useTranslation } from "react-i18next";
import {
	Copy,
	ExternalLink,
	Eye,
	FileText,
	Folder,
	Info,
	Loader2,
	Pencil,
	Save,
	Trash2,
} from "lucide-react";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Textarea } from "@/main/components/ui/textarea";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
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
// The read-only renderer, not the WYSIWYG editor: skill bodies are read
// verbatim by the agent, so nothing may rewrite fences or list nesting.
import { MarkdownMessageBody } from "@/main/modules/chat/components/message/MarkdownMessageBody";
import { useSkillsStore } from "@/main/stores/skills";
import { skillFileSystemService } from "@/services/filesystem/skill-filesystem";
import { logError } from "@/utils/logger";
import { cn } from "@/lib/utils";
import { SkillCategoryBadge } from "../utils/skill-category";

interface SkillDetailProps {
	enabled: boolean;
	agentName: string;
	onToggleEnabled: (name: string) => void;
}

/** Renders a bundled resource: markdown in the editor, images inline, rest as a note. */
const ResourceView: React.FC<{ skillName: string; resourcePath: string }> = ({
	skillName,
	resourcePath,
}) => {
	const { t } = useTranslation("skills");
	const [text, setText] = React.useState<string | null>(null);
	const [imageUrl, setImageUrl] = React.useState<string | null>(null);
	const [unsupported, setUnsupported] = React.useState(false);

	React.useEffect(() => {
		let objectUrl: string | null = null;
		let cancelled = false;

		setText(null);
		setImageUrl(null);
		setUnsupported(false);

		void skillFileSystemService
			.readSkillResource(skillName, resourcePath)
			.then((data) => {
				if (cancelled) return;
				if (/\.md$/i.test(resourcePath)) {
					setText(new TextDecoder().decode(data));
					return;
				}
				if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(resourcePath)) {
					// Copy into a fresh buffer so the Blob owns memory the FS may reuse.
					objectUrl = URL.createObjectURL(new Blob([data.slice()]));
					setImageUrl(objectUrl);
					return;
				}
				setUnsupported(true);
			})
			.catch((error) => {
				logError(`Failed to read resource ${resourcePath}:`, error);
				if (!cancelled) setUnsupported(true);
			});

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [skillName, resourcePath]);

	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<p className="mb-3 font-mono text-[11px] text-muted-foreground">
				{resourcePath}
			</p>
			{text !== null ? (
				<pre className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/25 p-4 font-mono text-xs leading-relaxed">
					{text}
				</pre>
			) : imageUrl ? (
				<img
					src={imageUrl}
					alt={resourcePath}
					className="max-w-full rounded-lg border border-border/60"
				/>
			) : unsupported ? (
				<p className="text-sm text-muted-foreground">
					{t("detail.resourceUnsupported")}
				</p>
			) : (
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			)}
		</div>
	);
};

export const SkillDetail: React.FC<SkillDetailProps> = ({
	enabled,
	agentName,
	onToggleEnabled,
}) => {
	const { t } = useTranslation(["skills", "common"]);
	const selected = useSkillsStore((state) => state.selected);
	const openSkill = useSkillsStore((state) => state.openSkill);
	const isOpening = useSkillsStore((state) => state.isOpening);
	const save = useSkillsStore((state) => state.save);
	const remove = useSkillsStore((state) => state.remove);
	const select = useSkillsStore((state) => state.select);

	const [description, setDescription] = React.useState("");
	const [body, setBody] = React.useState("");
	const [tab, setTab] = React.useState("edit");
	const [isSaving, setIsSaving] = React.useState(false);
	const [saveError, setSaveError] = React.useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = React.useState(false);

	const readOnly =
		openSkill?.readOnly === true || openSkill?.origin === "default";

	React.useEffect(() => {
		setDescription(openSkill?.description ?? "");
		setBody(openSkill?.body ?? "");
		setSaveError(null);
		setTab(readOnly ? "preview" : "edit");
	}, [openSkill?.name, openSkill?.description, openSkill?.body, readOnly]);

	const isDirty =
		!!openSkill &&
		!readOnly &&
		(description !== openSkill.description || body !== openSkill.body);

	const handleSave = React.useCallback(async () => {
		if (!openSkill || readOnly || !isDirty || isSaving) return;
		setIsSaving(true);
		setSaveError(null);
		try {
			await save(openSkill.name, description.trim(), body.trim());
		} catch (error) {
			setSaveError(
				error instanceof Error ? error.message : t("detail.saveFailed"),
			);
		} finally {
			setIsSaving(false);
		}
	}, [body, description, isDirty, isSaving, openSkill, readOnly, save, t]);

	// ⌘S / Ctrl-S is the expected gesture in an editor pane.
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void handleSave();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleSave]);

	const handleDuplicate = async () => {
		if (!openSkill) return;
		const copyName = `${openSkill.name}-copy`;
		await save(copyName, openSkill.description, openSkill.body);
	};

	if (isOpening && !openSkill) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				{/* Bundled skills stream their body from the publisher's repo, so this
				    can hang on a slow network rather than resolving instantly. */}
				<p className="text-xs text-muted-foreground">
					{t("detail.loading", { name: selected?.name ?? "" })}
				</p>
			</div>
		);
	}

	// A failed read must say so; returning null here left an empty pane with no
	// explanation of why the skill would not open.
	if (!openSkill || !selected) {
		if (!selected) return null;
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<p className="text-sm font-medium">
					{t("detail.loadFailedTitle", { name: selected.name })}
				</p>
				{/* The explanation, not the raw failure: bundled skills stream
					    their body from the publisher's repo, so this is nearly always
					    the network. The underlying error is already logged. */}
				<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
					{t("detail.loadFailedBody")}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void select({ name: selected.name })}
				>
					{t("buttons.retry", { ns: "common" })}
				</Button>
			</div>
		);
	}

	if (selected.resourcePath) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => void select({ name: openSkill.name })}
					>
						<FileText size={12} className="mr-1.5" />
						{openSkill.name}
					</Button>
				</div>
				<ResourceView
					skillName={openSkill.name}
					resourcePath={selected.resourcePath}
				/>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
				<div className="min-w-0">
					<h2 className="truncate font-mono text-sm font-semibold">
						{openSkill.name}
					</h2>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							{openSkill.format === "folder" ? (
								<Folder size={11} />
							) : (
								<FileText size={11} />
							)}
							{t(
								openSkill.format === "folder"
									? "detail.formatFolder"
									: "detail.formatFile",
							)}
						</span>
						{openSkill.version ? <span>v{openSkill.version}</span> : null}
						{openSkill.author ? <span>{openSkill.author}</span> : null}
						{readOnly ? (
							<Badge variant="secondary" className="h-5">
								{t("detail.readOnly")}
							</Badge>
						) : null}
						{openSkill.collection ? (
							<SkillCategoryBadge collection={openSkill.collection} />
						) : null}
						{openSkill.sourceUrl ? (
							<a
								href={openSkill.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
							>
								<ExternalLink size={11} />
								{t("detail.source")}
							</a>
						) : null}
					</div>
				</div>
				<Button
					type="button"
					size="sm"
					variant={enabled ? "secondary" : "default"}
					className="h-8 shrink-0"
					onClick={() => onToggleEnabled(openSkill.name)}
					title={t("detail.enabledForHint", { agent: agentName })}
				>
					{enabled
						? t("detail.enabledFor", { agent: agentName })
						: t("detail.enableFor", { agent: agentName })}
				</Button>
			</div>

			<Tabs
				value={tab}
				onValueChange={setTab}
				className="flex min-h-0 flex-1 flex-col"
			>
				<div className="border-b border-border px-4 py-2">
					<TabsList className="h-8">
						<TabsTrigger
							value="edit"
							disabled={readOnly}
							className="gap-1.5 px-3 text-xs"
						>
							<Pencil className="h-3 w-3" />
							{t("detail.tabs.edit")}
						</TabsTrigger>
						<TabsTrigger value="preview" className="gap-1.5 px-3 text-xs">
							<Eye className="h-3 w-3" />
							{t("detail.tabs.preview")}
						</TabsTrigger>
						<TabsTrigger value="about" className="gap-1.5 px-3 text-xs">
							<Info className="h-3 w-3" />
							{t("detail.tabs.about")}
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent
					value="edit"
					className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
				>
					<div className="space-y-1.5 border-b border-border px-4 py-3">
						<Label className="text-xs">{t("detail.descriptionLabel")}</Label>
						<Input
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder={t("detail.descriptionPlaceholder")}
							className="h-8 text-sm"
							disabled={readOnly}
						/>
						<p className="text-[11px] text-muted-foreground">
							{t("detail.descriptionHint")}
						</p>
					</div>
					{/* Raw markdown on purpose: this text is read verbatim by the agent,
					    so a WYSIWYG round-trip must not rewrite fences or list nesting. */}
					<Textarea
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder={t("detail.bodyPlaceholder")}
						className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0"
						disabled={readOnly}
						spellCheck={false}
					/>
				</TabsContent>

				<TabsContent
					value="preview"
					className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
				>
					{/* No per-code-block "Save": the skill is already a file, and the
					    save bar below owns writing it. */}
					<MarkdownMessageBody showCodeBlockSave={false}>
						{body}
					</MarkdownMessageBody>
				</TabsContent>

				<TabsContent
					value="about"
					className="mt-0 min-h-0 flex-1 overflow-y-auto p-4"
				>
					<dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
						{[
							["about.name", openSkill.name],
							["about.description", openSkill.description],
							["about.version", openSkill.version],
							["about.author", openSkill.author ?? openSkill.publisher],
							["about.tags", openSkill.tags?.join(", ")],
							["about.license", openSkill.license],
							["about.repo", openSkill.repo],
							["about.path", openSkill.path],
							[
								"about.format",
								t(
									openSkill.format === "folder"
										? "detail.formatFolder"
										: "detail.formatFile",
								),
							],
						]
							.filter(([, value]) => Boolean(value))
							.map(([key, value]) => (
								<React.Fragment key={key as string}>
									<dt className="text-muted-foreground">{t(key as string)}</dt>
									<dd className="break-words font-mono">{value}</dd>
								</React.Fragment>
							))}
					</dl>
				</TabsContent>
			</Tabs>

			{/* Save bar */}
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
				<div className="flex min-w-0 items-center gap-2 text-[11px]">
					{saveError ? (
						<span className="text-destructive">{saveError}</span>
					) : isDirty ? (
						<span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
							<span className="h-1.5 w-1.5 rounded-full bg-current" />
							{t("detail.unsaved")}
						</span>
					) : (
						<span className="text-muted-foreground">{t("detail.saved")}</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => void handleDuplicate()}
					>
						<Copy size={12} className="mr-1.5" />
						{readOnly ? t("detail.duplicateToEdit") : t("detail.duplicate")}
					</Button>
					{!readOnly ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
							onClick={() => setDeleteOpen(true)}
						>
							<Trash2 size={12} />
						</Button>
					) : null}
					<Button
						type="button"
						size="sm"
						className={cn("h-7 px-3 text-xs", readOnly && "hidden")}
						disabled={!isDirty || isSaving}
						onClick={() => void handleSave()}
					>
						{isSaving ? (
							<Loader2 size={12} className="mr-1.5 animate-spin" />
						) : (
							<Save size={12} className="mr-1.5" />
						)}
						{t("buttons.save", { ns: "common" })}
					</Button>
				</div>
			</div>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("detail.delete.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("detail.delete.description", { name: openSkill.name })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{t("buttons.cancel", { ns: "common" })}
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => void remove(openSkill.name)}
						>
							{t("buttons.delete", { ns: "common" })}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};
