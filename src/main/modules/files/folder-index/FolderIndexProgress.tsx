import { useTranslation } from "react-i18next";
import type { RunningFolderIndexProgress } from "./FolderIndexContext";

/** Counts describe the whole active root, even when viewing one of its children. */
export const FolderIndexProgress = ({
	progress,
	label,
}: {
	progress: RunningFolderIndexProgress;
	label: string;
}) => {
	const { t } = useTranslation("documents");
	const completed = progress.successful + progress.failed;
	const counts = t("folderIndex.progress.counts", {
		successful: progress.successful,
		indexing: progress.indexing,
		total: progress.total,
	});
	const failures = progress.failed
		? t("folderIndex.progress.failed", { count: progress.failed })
		: null;
	const scope = `${label} · ${progress.root}`;

	return (
		<div className="mt-1.5 space-y-1 text-muted-foreground">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span className="min-w-0 truncate" title={scope}>
					{scope}
				</span>
				<span className="tabular-nums">
					{counts}
					{failures && <span className="text-destructive"> · {failures}</span>}
				</span>
			</div>
			<progress
				className="block h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-sky-500/10 [&::-webkit-progress-value]:bg-sky-500 [&::-moz-progress-bar]:bg-sky-500"
				value={completed}
				max={Math.max(1, progress.total)}
				aria-label={t("folderIndex.progress.label", {
					type: label,
					folder: progress.root,
				})}
				aria-valuetext={failures ? `${counts} · ${failures}` : counts}
			/>
		</div>
	);
};
