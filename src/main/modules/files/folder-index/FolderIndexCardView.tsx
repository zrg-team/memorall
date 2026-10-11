import {
	ArrowDownLeft,
	ArrowUpRight,
	ExternalLink,
	FileText,
	IdCard,
	Loader2,
	Pencil,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Textarea } from "@/main/components/ui/textarea";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import { parentFolder } from "@/services/folder-index/index-config";
import type { FolderIndexCard } from "@/services/folder-index/operation-types";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

interface Draft {
	type: string;
	title: string;
	description: string;
	tags: string;
}

const draftOf = (card: FolderIndexCard): Draft => ({
	type: card.type,
	title: card.title ?? "",
	description: card.description ?? "",
	tags: card.tags.join(", "),
});

export interface CardLink {
	path: string;
	label: string;
}

const nameOf = (path: string) => path.split("/").pop() ?? path;

const TRUST_TONE: Record<FolderIndexCard["trust"], string> = {
	unverified: "text-muted-foreground",
	"machine-confirmed": "border-sky-500/40 text-sky-700 dark:text-sky-300",
	"human-reviewed":
		"border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

/** A fact line "Size: 1.5 KB" as its label and value. */
const splitFact = (fact: string): [string, string] => {
	const index = fact.indexOf(": ");
	return index > 0 ? [fact.slice(0, index), fact.slice(index + 2)] : ["", fact];
};

/**
 * A file's OKF card, read and edited in place: in the card dialog, and as the
 * side panel of the index graph. Editing records the user as its reviewer,
 * and the indexer keeps those fields when the file changes.
 */
export const FolderIndexCardView: React.FC<{
	path: string;
	/** Cards linking to this one, when the caller knows them (the graph). */
	incoming?: CardLink[];
	/** Labels for linked cards, when the caller knows them (the graph). */
	labelOf?: (path: string) => string | undefined;
	/** Moving to a linked card; defaults to opening it in the card dialog. */
	onSelectPath?: (path: string) => void;
	onClose?: () => void;
	className?: string;
}> = ({ path, incoming, labelOf, onSelectPath, onClose, className }) => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const [card, setCard] = React.useState<FolderIndexCard | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [editing, setEditing] = React.useState(false);
	const [draft, setDraft] = React.useState<Draft | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setCard(null);
		setEditing(false);
		setError(null);
		setLoading(true);
		let cancelled = false;
		void folderIndexClient
			.request("card.get", { path })
			.then((result) => {
				if (cancelled) return;
				setCard(result);
				if (result) setDraft(draftOf(result));
			})
			.catch((err: unknown) => {
				if (!cancelled)
					setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [path]);

	const save = async () => {
		if (!draft) return;
		try {
			const saved = await folderIndexClient.request("card.save", {
				path,
				fields: {
					type: draft.type,
					title: draft.title,
					description: draft.description,
					tags: draft.tags
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
				},
			});
			if (saved) {
				setCard(saved);
				setDraft(draftOf(saved));
			}
			setEditing(false);
			index?.loadEntries(parentFolder(path) ?? "/");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const select = onSelectPath ?? ((target: string) => index?.openCard(target));
	const linkLabel = (target: string) => labelOf?.(target) ?? nameOf(target);

	const field = (key: keyof Draft, label: string, multiline = false) => (
		<div className="space-y-1">
			<Label
				htmlFor={`okf-card-${key}`}
				className="text-[11px] text-muted-foreground"
			>
				{label}
			</Label>
			{multiline ? (
				<Textarea
					id={`okf-card-${key}`}
					rows={3}
					value={draft?.[key] ?? ""}
					onChange={(event) =>
						setDraft(
							(current) => current && { ...current, [key]: event.target.value },
						)
					}
					className="text-xs"
				/>
			) : (
				<Input
					id={`okf-card-${key}`}
					value={draft?.[key] ?? ""}
					onChange={(event) =>
						setDraft(
							(current) => current && { ...current, [key]: event.target.value },
						)
					}
					className="h-8 text-xs"
				/>
			)}
		</div>
	);

	const linkList = (
		title: string,
		Icon: typeof ArrowUpRight,
		links: CardLink[],
	) =>
		links.length > 0 && (
			<section className="space-y-1">
				<p className="text-[11px] font-medium text-muted-foreground">
					{title} · {links.length}
				</p>
				<div className="flex flex-col">
					{links.map((link) => (
						<button
							key={link.path}
							type="button"
							title={link.path}
							onClick={() => select(link.path)}
							className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
						>
							<Icon className="h-3 w-3 shrink-0 text-sky-600 dark:text-sky-400" />
							<span className="truncate">{link.label}</span>
						</button>
					))}
				</div>
			</section>
		);

	const title = card?.title ?? nameOf(path);

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex items-start gap-2 border-b px-4 py-3">
				<IdCard className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold" title={title}>
						{title}
					</p>
					<p className="break-all font-mono text-[10.5px] text-muted-foreground">
						{path}
					</p>
				</div>
				<IndexTypeBadge label="OKF" />
				{onClose && (
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 shrink-0 p-0"
						aria-label={t("folderIndex.card.close")}
						onClick={onClose}
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>

			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
				{loading && (
					<div className="flex justify-center py-6">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
					</div>
				)}
				{error && (
					<p className="text-xs text-red-600 dark:text-red-400">{error}</p>
				)}
				{!loading && !card && !error && (
					<p className="text-xs text-muted-foreground">
						{t("folderIndex.card.none")}
					</p>
				)}

				{card && editing && (
					<div className="space-y-3">
						{field("type", t("folderIndex.card.type"))}
						{field("title", t("folderIndex.card.name"))}
						{field("description", t("folderIndex.card.description"), true)}
						{field("tags", t("folderIndex.card.tags"))}
					</div>
				)}

				{card && !editing && (
					<>
						<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
							<span className="rounded-md border px-1.5 py-px">
								{card.type}
							</span>
							<span
								className={cn(
									"rounded-md border px-1.5 py-px",
									TRUST_TONE[card.trust],
								)}
							>
								{t(`folderIndex.card.trust.${card.trust}`)}
							</span>
							{card.status !== "stable" && (
								<span className="rounded-md border border-amber-500/40 px-1.5 py-px text-amber-700 dark:text-amber-300">
									{card.status}
								</span>
							)}
							{card.stale && (
								<span className="rounded-md border border-amber-500/40 px-1.5 py-px text-amber-700 dark:text-amber-300">
									{t("folderIndex.card.stale")}
								</span>
							)}
						</div>

						{card.description && (
							<p className="line-clamp-4 break-words text-sm leading-relaxed">
								{card.description}
							</p>
						)}

						{card.tags.length > 0 && (
							<div className="flex flex-wrap gap-1">
								{card.tags.map((tag) => (
									<span
										key={tag}
										className="rounded-full bg-muted px-2 py-px text-[11px]"
									>
										#{tag}
									</span>
								))}
							</div>
						)}

						{card.facts.length > 0 && (
							<section className="space-y-1">
								<p className="text-[11px] font-medium text-muted-foreground">
									{t("folderIndex.card.details")}
								</p>
								<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
									{card.facts
										.filter((fact) => !fact.startsWith("Path: "))
										.map((fact) => {
											const [label, value] = splitFact(fact);
											return (
												<React.Fragment key={fact}>
													<dt className="text-muted-foreground">{label}</dt>
													<dd className="truncate" title={value}>
														{value}
													</dd>
												</React.Fragment>
											);
										})}
								</dl>
							</section>
						)}

						{linkList(
							t("folderIndex.card.linksTo"),
							ArrowUpRight,
							card.links.map((target) => ({
								path: target,
								label: linkLabel(target),
							})),
						)}
						{linkList(
							t("folderIndex.card.linkedFrom"),
							ArrowDownLeft,
							incoming ?? [],
						)}

						{card.notes && (
							<section className="space-y-1">
								<p className="text-[11px] font-medium text-muted-foreground">
									{t("folderIndex.card.notes")}
								</p>
								<p className="whitespace-pre-wrap rounded-md border px-3 py-2 text-xs leading-relaxed">
									{card.notes}
								</p>
							</section>
						)}

						{card.excerpt && (
							<details className="group rounded-md border">
								<summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
									{t("folderIndex.card.excerpt")}
								</summary>
								<pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
									{card.excerpt}
								</pre>
							</details>
						)}

						<details className="rounded-md border">
							<summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
								{t("folderIndex.card.raw")}
							</summary>
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t bg-muted/40 px-3 py-2 font-mono text-[10.5px] leading-relaxed">
								{card.text}
							</pre>
						</details>

						<p className="text-[11px] text-muted-foreground">
							{t("folderIndex.card.hint")}
						</p>
					</>
				)}
			</div>

			{card && (
				<div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
					{editing ? (
						<>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setEditing(false);
									setDraft(draftOf(card));
								}}
							>
								{t("folderIndex.cancel")}
							</Button>
							<Button size="sm" onClick={() => void save()}>
								{t("folderIndex.card.save")}
							</Button>
						</>
					) : (
						<>
							{index?.openFile && (
								<Button
									variant="ghost"
									size="sm"
									className="gap-1.5"
									onClick={() => index.openFile?.(path)}
								>
									<FileText className="h-3.5 w-3.5" />
									{t("folderIndex.card.openFile")}
									<ExternalLink className="h-3 w-3 opacity-60" />
								</Button>
							)}
							<Button
								variant="outline"
								size="sm"
								className="gap-1.5"
								onClick={() => setEditing(true)}
							>
								<Pencil className="h-3.5 w-3.5" />
								{t("folderIndex.card.edit")}
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
};
