import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** An index type's short name, as the tree, list and settings show it. */
export const IndexTypeBadge: React.FC<{
	label: string;
	muted?: boolean;
	/** Adds a Beta tag after the name. */
	beta?: boolean;
	className?: string;
	title?: string;
}> = ({ label, muted = false, beta = false, className, title }) => {
	const { t } = useTranslation("documents");
	const badge = (
		<span
			title={title}
			className={cn(
				"inline-flex shrink-0 items-center rounded-sm border px-1 py-px text-[10px] font-medium uppercase tracking-wide",
				muted
					? "text-muted-foreground"
					: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
				!beta && className,
			)}
		>
			{label}
		</span>
	);
	if (!beta) return badge;
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
			{badge}
			<span className="inline-flex shrink-0 items-center rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
				{t("folderIndex.beta")}
			</span>
		</span>
	);
};
