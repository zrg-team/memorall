import { diffLines } from "diff";
import { AlertTriangle } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";

/** Unchanged runs longer than this fold down to their edges. */
const CONTEXT_LINES = 3;

type DiffLine =
	| { kind: "added" | "removed" | "same"; text: string }
	| { kind: "fold"; count: number };

function diffRows(before: string, after: string): DiffLine[] {
	const rows: DiffLine[] = [];
	for (const part of diffLines(before, after)) {
		const lines = part.value.replace(/\n$/, "").split("\n");
		if (part.added || part.removed) {
			const kind = part.added ? "added" : "removed";
			for (const text of lines) rows.push({ kind, text });
			continue;
		}
		if (lines.length > CONTEXT_LINES * 2 + 1) {
			const head = lines.slice(0, CONTEXT_LINES);
			const tail = lines.slice(-CONTEXT_LINES);
			for (const text of head) rows.push({ kind: "same", text });
			rows.push({ kind: "fold", count: lines.length - CONTEXT_LINES * 2 });
			for (const text of tail) rows.push({ kind: "same", text });
		} else {
			for (const text of lines) rows.push({ kind: "same", text });
		}
	}
	return rows;
}

const TextDiff: React.FC<{ before: string; after: string }> = ({
	before,
	after,
}) => {
	const { t } = useTranslation("documents");
	const rows = useMemo(() => diffRows(before, after), [before, after]);
	return (
		<div className="max-h-64 overflow-auto border-t border-amber-300/60 bg-background font-mono text-[11px] leading-snug dark:border-amber-500/30">
			{rows.map((row, index) =>
				row.kind === "fold" ? (
					<div key={index} className="px-2 py-0.5 text-muted-foreground italic">
						{t("conflict.unchangedLines", {
							count: row.count,
							defaultValue: "⋯ {{count}} unchanged lines",
						})}
					</div>
				) : (
					<div
						key={index}
						className={cn(
							"whitespace-pre-wrap break-all px-2",
							row.kind === "added" &&
								"bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
							row.kind === "removed" &&
								"bg-red-500/15 text-red-800 dark:text-red-300",
							row.kind === "same" && "text-muted-foreground",
						)}
					>
						{row.kind === "added" ? "+ " : row.kind === "removed" ? "- " : "  "}
						{row.text}
					</div>
				),
			)}
		</div>
	);
};

interface FileConflictBannerProps {
	/** The text the unsaved edits started from. */
	base: string;
	/** The text the file holds now. */
	disk: string;
	onReload: () => void;
	onKeepMine: () => Promise<void> | void;
}

/**
 * Tells the user the file changed under their unsaved edits — usually the
 * agent writing it — and lets them see what changed, take it, or keep theirs.
 */
export const FileConflictBanner: React.FC<FileConflictBannerProps> = ({
	base,
	disk,
	onReload,
	onKeepMine,
}) => {
	const { t } = useTranslation("documents");
	const [showChanges, setShowChanges] = useState(false);
	const [saving, setSaving] = useState(false);

	const keepMine = async () => {
		setSaving(true);
		try {
			await onKeepMine();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			role="alert"
			className="flex-shrink-0 border-b border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
		>
			<div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
				<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
				<span className="min-w-0 flex-1">
					{t("conflict.message", {
						defaultValue:
							"This file changed outside the editor while you were editing it.",
					})}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={() => setShowChanges((shown) => !shown)}
				>
					{showChanges
						? t("conflict.hideChanges", { defaultValue: "Hide changes" })
						: t("conflict.showChanges", { defaultValue: "Show changes" })}
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={onReload}
					disabled={saving}
				>
					{t("conflict.reload", { defaultValue: "Reload" })}
				</Button>
				<Button
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={() => void keepMine()}
					disabled={saving}
				>
					{t("conflict.keepMine", { defaultValue: "Keep mine" })}
				</Button>
			</div>
			{showChanges && <TextDiff before={base} after={disk} />}
		</div>
	);
};
