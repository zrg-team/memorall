import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	FileText,
	Folder,
	Loader2,
	XCircle,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { cn } from "@/lib/utils";
import type { SkillImportCandidate } from "@/services/filesystem/skill-filesystem";

interface SkillImportReviewProps {
	candidates: SkillImportCandidate[];
	existingNames: Set<string>;
	onCancel: () => void;
	onConfirm: (selected: SkillImportCandidate[]) => Promise<void>;
}

/**
 * Upload, folder, and repo lanes can each produce many skills at once. Writing
 * them silently would overwrite existing work and import unusable files, so
 * every batch stops here first.
 */
export const SkillImportReview: React.FC<SkillImportReviewProps> = ({
	candidates,
	existingNames,
	onCancel,
	onConfirm,
}) => {
	const { t } = useTranslation(["skills", "common"]);
	const [importing, setImporting] = React.useState(false);
	const [checked, setChecked] = React.useState<Set<string>>(
		() =>
			new Set(
				candidates
					.filter((candidate) => candidate.errors.length === 0)
					.map((candidate) => candidate.name),
			),
	);

	const toggle = (name: string) =>
		setChecked((previous) => {
			const next = new Set(previous);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});

	const selected = candidates.filter((candidate) =>
		checked.has(candidate.name),
	);

	const handleConfirm = async () => {
		setImporting(true);
		try {
			await onConfirm(selected);
		} finally {
			setImporting(false);
		}
	};

	if (candidates.length === 0) {
		return (
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<div className="mx-auto max-w-2xl space-y-3">
					<h2 className="text-base font-semibold">{t("import.noneTitle")}</h2>
					<p className="text-sm text-muted-foreground">
						{t("import.noneBody")}
					</p>
					<Button type="button" variant="outline" size="sm" onClick={onCancel}>
						{t("buttons.back", { ns: "common" })}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<div className="mx-auto max-w-2xl space-y-4">
					<div>
						<h2 className="text-base font-semibold">
							{t("import.title", { count: candidates.length })}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{t("import.subtitle")}
						</p>
					</div>

					<div className="divide-y divide-border/60 rounded-xl border border-border/60">
						{candidates.map((candidate) => {
							const blocked = candidate.errors.length > 0;
							const replaces = existingNames.has(candidate.name);
							return (
								<label
									key={candidate.name}
									className={cn(
										"flex cursor-pointer items-start gap-3 px-3 py-2.5",
										blocked && "cursor-not-allowed opacity-60",
									)}
								>
									<input
										type="checkbox"
										className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-500"
										checked={checked.has(candidate.name)}
										disabled={blocked}
										onChange={() => toggle(candidate.name)}
									/>
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-center gap-2">
											<span className="truncate font-mono text-xs font-medium">
												{candidate.name}
											</span>
											<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
												{candidate.format === "folder" ? (
													<>
														<Folder size={10} />
														{t("import.folderCount", {
															count: candidate.resources.length + 1,
														})}
													</>
												) : (
													<>
														<FileText size={10} />
														{t("detail.formatFile")}
													</>
												)}
											</span>
											{replaces && !blocked ? (
												<span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
													<AlertTriangle size={10} />
													{t("import.replaces")}
												</span>
											) : null}
										</span>
										{candidate.description ? (
											<span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
												{candidate.description}
											</span>
										) : null}
										{candidate.errors.map((error) => (
											<span
												key={error}
												className="mt-1 flex items-start gap-1 text-[10px] text-destructive"
											>
												<XCircle size={10} className="mt-px shrink-0" />
												{error}
											</span>
										))}
										{candidate.warnings.map((warning) => (
											<span
												key={warning}
												className="mt-1 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400"
											>
												<AlertTriangle size={10} className="mt-px shrink-0" />
												{warning}
											</span>
										))}
									</span>
								</label>
							);
						})}
					</div>
				</div>
			</div>

			<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onCancel}
					disabled={importing}
				>
					{t("buttons.cancel", { ns: "common" })}
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={selected.length === 0 || importing}
					onClick={() => void handleConfirm()}
				>
					{importing ? (
						<Loader2 size={12} className="mr-1.5 animate-spin" />
					) : null}
					{t("import.confirm", { count: selected.length })}
				</Button>
			</div>
		</div>
	);
};
