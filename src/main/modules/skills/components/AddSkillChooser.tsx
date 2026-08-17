import React from "react";
import { useTranslation } from "react-i18next";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
import { FolderUp, Pencil, Plus, Shield, Upload } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { cn } from "@/lib/utils";
import type { SkillLane } from "@/main/stores/skills";

interface AddSkillChooserProps {
	onSelect: (lane: SkillLane) => void;
	className?: string;
	/** Hide the storage footnote when the host already shows one. */
	compact?: boolean;
}

interface LaneCard {
	lane: SkillLane;
	icon: React.ReactNode;
	accent: string;
	recommended?: boolean;
}

const LANES: LaneCard[] = [
	{
		lane: "manual",
		icon: <Pencil size={13} />,
		accent: "from-blue-700 to-blue-400",
		recommended: true,
	},
	{
		lane: "github",
		icon: <Github size={13} />,
		accent: "from-slate-700 to-slate-400",
	},
	{
		lane: "upload",
		icon: <Upload size={13} />,
		accent: "from-emerald-700 to-emerald-400",
	},
	{
		lane: "folder",
		icon: <FolderUp size={13} />,
		accent: "from-amber-700 to-amber-400",
	},
];

/**
 * The four ways in. Rendered both as the page's empty state and as the "add"
 * screen, so it takes no layout assumptions from either. Container queries, not
 * viewport ones — this sits inside a right panel that can be half the window.
 */
export const AddSkillChooser: React.FC<AddSkillChooserProps> = ({
	onSelect,
	className,
	compact = false,
}) => {
	const { t } = useTranslation("skills");

	return (
		<div className={cn("@container space-y-4", className)}>
			<div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
				{LANES.map((card) => (
					<div
						key={card.lane}
						className={cn(
							"flex flex-col gap-2.5 rounded-xl border p-3.5",
							card.recommended
								? "border-blue-500/30 bg-background/60 shadow-[0_0_0_1px_rgba(59,130,246,0.08)]"
								: "border-border/60 bg-background/60",
						)}
					>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span
								className={cn(
									"grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white",
									card.accent,
								)}
							>
								{card.icon}
							</span>
							<span className="shrink-0 text-sm font-semibold">
								{t(`lanes.${card.lane}.name`)}
							</span>
							{card.recommended ? (
								<span className="shrink-0 whitespace-nowrap rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
									{t("lanes.recommended")}
								</span>
							) : null}
						</div>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{t(`lanes.${card.lane}.body`)}
						</p>
						<Button
							type="button"
							size="sm"
							variant={card.recommended ? "default" : "outline"}
							className="mt-auto w-full"
							onClick={() => onSelect(card.lane)}
						>
							{t(`lanes.${card.lane}.action`)}
						</Button>
					</div>
				))}
			</div>

			{compact ? null : (
				<div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 px-3 py-2.5">
					<Shield size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{t("empty.storage")}
					</p>
				</div>
			)}
		</div>
	);
};

export const AddSkillButton: React.FC<{ onClick: () => void }> = ({
	onClick,
}) => {
	const { t } = useTranslation("skills");
	return (
		<Button type="button" size="sm" className="w-full" onClick={onClick}>
			<Plus size={13} className="mr-1.5" />
			{t("add")}
		</Button>
	);
};
