import { AlertTriangle, Library, Loader2, Plus, RefreshCw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Label } from "@/main/components/ui/label";
import { Switch } from "@/main/components/ui/switch";
import { Textarea } from "@/main/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

const SIZE_OPTIONS_MB = [10, 50, 200, 1024];

/**
 * Files › Indexes: the index types there are, the folders that have them and
 * the indexing rules. The only place folders are chosen; the agent feature
 * only reads what is set here.
 */
export const FolderIndexesDialog: React.FC = () => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const [skipDraft, setSkipDraft] = React.useState("");
	const settings = index?.state?.settings;

	const savedPatterns = settings?.skipPatterns.join("\n");
	// The draft follows the saved patterns when the dialog opens or they
	// arrive, never while the user is typing in it.
	const typing = React.useRef(false);
	React.useEffect(() => {
		if (index?.dialogOpen && savedPatterns !== undefined && !typing.current) {
			setSkipDraft(savedPatterns);
		}
		if (!index?.dialogOpen) typing.current = false;
	}, [index?.dialogOpen, savedPatterns]);

	if (!index) return null;
	const { state, types } = index;
	const folders = state?.folders ?? [];

	return (
		<Dialog open={index.dialogOpen} onOpenChange={index.setDialogOpen}>
			<DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-3xl">
				<DialogHeader className="px-6 pt-6">
					<DialogTitle className="flex items-center gap-2">
						<Library className="h-5 w-5 text-sky-600 dark:text-sky-400" />
						{t("folderIndex.title")}
					</DialogTitle>
					<DialogDescription>{t("folderIndex.description")}</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
					{index.error && (
						<p className="text-xs text-red-600 dark:text-red-400">
							{index.error}
						</p>
					)}

					<section className="space-y-2">
						<p className="text-[11px] font-medium text-muted-foreground">
							{t("folderIndex.types")}
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{types.map((type) => (
								<div
									key={type.id}
									className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-xs"
								>
									<IndexTypeBadge label={type.label} beta={type.beta} />
									<div className="min-w-0 flex-1">
										<p className="text-[11px] text-muted-foreground">
											{type.description}
										</p>
										{type.beta && (
											<p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
												<AlertTriangle className="mt-px h-3 w-3 shrink-0" />
												<span>{t("folderIndex.betaNote")}</span>
											</p>
										)}
										<p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
											{type.tools.join(" · ")}
										</p>
									</div>
								</div>
							))}
							<div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
								<Plus className="h-3.5 w-3.5 shrink-0" />
								<span>{t("folderIndex.moreTypes")}</span>
							</div>
						</div>
					</section>

					<section className="space-y-2">
						<p className="text-[11px] font-medium text-muted-foreground">
							{t("folderIndex.folders")}
						</p>
						{index.effectiveAt(index.currentFolder).length === 0 && (
							<div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
								<span className="min-w-0 flex-1">
									{t("folderIndex.currentFolder")}{" "}
									<span className="font-medium">{index.currentFolder}</span>
								</span>
								{types.map((type) => (
									<Button
										key={type.id}
										size="sm"
										className="h-7 gap-1.5 px-2.5 text-xs"
										onClick={() =>
											void index.setFolderType(
												index.currentFolder,
												type.id,
												true,
											)
										}
									>
										<Plus className="h-3.5 w-3.5" />
										{t("folderIndex.addType", { type: type.label })}
									</Button>
								))}
							</div>
						)}
						{folders.length === 0 ? (
							<p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
								{t("folderIndex.noFolders")}
							</p>
						) : (
							<div className="overflow-x-auto rounded-md border">
								<table className="w-full min-w-[560px] text-xs">
									<thead className="text-left text-[11px] text-muted-foreground">
										<tr className="border-b">
											<th className="px-3 py-2 font-medium">
												{t("folderIndex.folder")}
											</th>
											{types.map((type) => (
												<th key={type.id} className="px-3 py-2 font-medium">
													<IndexTypeBadge label={type.label} beta={type.beta} />
												</th>
											))}
											<th className="px-3 py-2 font-medium">
												{t("folderIndex.files")}
											</th>
											<th className="px-3 py-2" />
										</tr>
									</thead>
									<tbody className="divide-y">
										{folders.map((folder) => {
											const busy = index.isRunning(folder.path);
											const files = folder.status.reduce(
												(total, status) => Math.max(total, status.entries),
												0,
											);
											return (
												<tr
													key={folder.path}
													className={cn(
														!folder.effective.length && "text-muted-foreground",
													)}
												>
													<td className="px-3 py-2">
														<span className="font-medium">{folder.path}</span>
														{folder.mapped && (
															<span className="ml-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] uppercase text-amber-600 dark:text-amber-400">
																{t("mappedFolders.badge")}
															</span>
														)}
													</td>
													{types.map((type) => (
														<td key={type.id} className="px-3 py-2">
															<Switch
																checked={folder.effective.includes(type.id)}
																aria-label={t("folderIndex.toggleType", {
																	type: type.label,
																	folder: folder.path,
																})}
																onCheckedChange={(checked) =>
																	void index.setFolderType(
																		folder.path,
																		type.id,
																		checked,
																		{
																			mapped: folder.mapped,
																		},
																	)
																}
															/>
														</td>
													))}
													<td className="px-3 py-2 tabular-nums">
														{busy ? (
															<span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
																<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
																{t("folderIndex.indexing")}
															</span>
														) : folder.status.length ? (
															<span>
																{files}
																{folder.status.some(
																	(status) => status.chunks !== undefined,
																) && (
																	<span className="ml-1.5 text-muted-foreground">
																		·{" "}
																		{t("folderIndex.embedding.chunkCount", {
																			count: folder.status.reduce(
																				(sum, status) =>
																					sum + (status.chunks ?? 0),
																				0,
																			),
																		})}
																	</span>
																)}
															</span>
														) : folder.off.length ? (
															t("folderIndex.turnedOff")
														) : (
															"–"
														)}
													</td>
													<td className="px-3 py-2 text-right">
														{folder.status.length > 0 && (
															<Button
																variant="ghost"
																size="sm"
																className="h-7 gap-1 px-2 text-xs"
																disabled={busy}
																onClick={() => void index.rebuild(folder.path)}
															>
																<RefreshCw className="h-3 w-3" />
																{t("folderIndex.rebuild")}
															</Button>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
						<p className="text-[11px] text-muted-foreground">
							{t("folderIndex.addHint")}
						</p>
						{folders
							.flatMap((folder) =>
								folder.status.flatMap((status) => status.errors ?? []),
							)
							.slice(0, 10)
							.map((error) => (
								<p
									key={error.path}
									className="break-all text-xs text-destructive"
								>
									{error.path}: {error.message}
								</p>
							))}
					</section>

					{settings && (
						<section className="grid gap-4 md:grid-cols-3">
							<div className="col-span-full space-y-3 rounded-md border p-3">
								<div className="flex items-center gap-2">
									<Switch
										id="folder-index-pause-embeddings"
										checked={settings.embeddingPaused ?? false}
										onCheckedChange={(paused) =>
											void index.saveSettings({ embeddingPaused: paused })
										}
									/>
									<Label
										htmlFor="folder-index-pause-embeddings"
										className="text-xs font-normal"
									>
										{t("folderIndex.embeddingPause")}
									</Label>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="space-y-1">
										<Label htmlFor="folder-index-batch" className="text-xs">
											{t("folderIndex.embeddingBatch")}
										</Label>
										<select
											id="folder-index-batch"
											value={settings.embeddingBatchSize ?? 4}
											onChange={(event) =>
												void index.saveSettings({
													embeddingBatchSize: Number(event.target.value),
												})
											}
											className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
										>
											{[
												...new Set([
													1,
													2,
													4,
													8,
													16,
													settings.embeddingBatchSize ?? 4,
												]),
											]
												.sort((a, b) => a - b)
												.map((size) => (
													<option key={size} value={size}>
														{size}
													</option>
												))}
										</select>
									</div>
									<div className="space-y-1">
										<Label htmlFor="folder-index-throttle" className="text-xs">
											{t("folderIndex.embeddingThrottle")}
										</Label>
										<select
											id="folder-index-throttle"
											value={settings.embeddingPauseMs ?? 150}
											onChange={(event) =>
												void index.saveSettings({
													embeddingPauseMs: Number(event.target.value),
												})
											}
											className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
										>
											{[
												...new Set([
													50,
													150,
													300,
													750,
													1500,
													settings.embeddingPauseMs ?? 150,
												]),
											]
												.sort((a, b) => a - b)
												.map((ms) => (
													<option key={ms} value={ms}>
														{ms} ms
													</option>
												))}
										</select>
									</div>
								</div>
								<p className="text-[11px] text-muted-foreground">
									{t("folderIndex.embeddingWorkHint")}
								</p>
							</div>
							<div className="space-y-1">
								<Label
									htmlFor="folder-index-skip"
									className="text-[11px] text-muted-foreground"
								>
									{t("folderIndex.skipPatterns")}
								</Label>
								<Textarea
									id="folder-index-skip"
									rows={4}
									value={skipDraft}
									onChange={(event) => {
										typing.current = true;
										setSkipDraft(event.target.value);
									}}
									onBlur={() => {
										typing.current = false;
										const patterns = skipDraft
											.split("\n")
											.map((line) => line.trim())
											.filter(Boolean);
										if (
											patterns.join("\n") !== settings.skipPatterns.join("\n")
										) {
											void index.saveSettings({ skipPatterns: patterns });
										}
									}}
									className="font-mono text-[11px]"
								/>
								<p className="text-[10px] text-muted-foreground">
									{t("folderIndex.skipHint")}
								</p>
							</div>
							<div className="space-y-1">
								<Label
									htmlFor="folder-index-max"
									className="text-[11px] text-muted-foreground"
								>
									{t("folderIndex.maxSize")}
								</Label>
								<select
									id="folder-index-max"
									value={Math.round(settings.maxFileBytes / (1024 * 1024))}
									onChange={(event) =>
										void index.saveSettings({
											maxFileBytes: Number(event.target.value) * 1024 * 1024,
										})
									}
									className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
								>
									{[
										...new Set([
											...SIZE_OPTIONS_MB,
											Math.round(settings.maxFileBytes / (1024 * 1024)),
										]),
									]
										.sort((a, b) => a - b)
										.map((mb) => (
											<option key={mb} value={mb}>
												{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
											</option>
										))}
								</select>
							</div>
							<div className="space-y-2 text-xs">
								<div className="flex items-center gap-2">
									<Switch
										id="folder-index-ask-mapped"
										checked={settings.askBeforeMapped}
										onCheckedChange={(checked) =>
											void index.saveSettings({ askBeforeMapped: checked })
										}
									/>
									<Label
										htmlFor="folder-index-ask-mapped"
										className="text-xs font-normal"
									>
										{t("folderIndex.askBeforeMapped")}
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<Switch
										id="folder-index-agents-ask"
										checked={settings.agentsMayAsk}
										onCheckedChange={(checked) =>
											void index.saveSettings({ agentsMayAsk: checked })
										}
									/>
									<Label
										htmlFor="folder-index-agents-ask"
										className="text-xs font-normal"
									>
										{t("folderIndex.agentsMayAsk")}
									</Label>
								</div>
							</div>
						</section>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
