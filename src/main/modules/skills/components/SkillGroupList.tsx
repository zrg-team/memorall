import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	groupSkills,
	IN_USE_GROUP_KEY,
	type SkillGroup,
} from "../utils/group-skills";
import type { SkillSummary } from "@/services/filesystem/skill-filesystem";
import { matchesSkillQuery } from "../utils/skill-category";

interface SkillGroupListProps {
	skills: SkillSummary[];
	query: string;
	enabledSkillNames: Set<string>;
	inUseLabel: string;
	customLabel: string;
	/** Row renderer — the page draws a tree row, the picker draws a toggle row. */
	renderSkill: (skill: SkillSummary, enabled: boolean) => React.ReactNode;
	emptyMessage: string;
	className?: string;
}

/**
 * The grouped skill list, shared by the Skills page sidebar and the agent-config
 * picker so both order and collapse identically.
 *
 * Category groups start collapsed: the bundled library is >100 rows and mounting
 * all of them on arrival is pure cost for a list the user mostly scrolls past.
 * "In use" and "Yours" start open because they are small and are what the user
 * came for.
 */
export const SkillGroupList: React.FC<SkillGroupListProps> = ({
	skills,
	query,
	enabledSkillNames,
	inUseLabel,
	customLabel,
	renderSkill,
	emptyMessage,
	className,
}) => {
	const groups = React.useMemo(
		() =>
			groupSkills(
				skills.filter((skill) => matchesSkillQuery(skill, query)),
				{ inUseLabel, customLabel, enabledNames: enabledSkillNames },
			),
		[skills, query, inUseLabel, customLabel, enabledSkillNames],
	);

	// Only the deliberate opens/closes are stored; everything else falls back to
	// the group's default. Keeping overrides sparse means a group that appears
	// later (a new category after an import) still gets the right default.
	const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

	const isSearching = query.trim().length > 0;

	const isExpanded = (group: SkillGroup) =>
		// A search that silently matched inside a collapsed group looks broken, so
		// searching opens everything that has a hit.
		isSearching || (overrides[group.key] ?? group.defaultExpanded);

	const toggle = (group: SkillGroup) =>
		setOverrides((previous) => ({
			...previous,
			[group.key]: !(previous[group.key] ?? group.defaultExpanded),
		}));

	if (groups.length === 0) {
		return (
			<p className="px-3 py-4 text-xs text-muted-foreground">{emptyMessage}</p>
		);
	}

	return (
		<div className={cn("flex flex-col gap-0.5 p-2", className)}>
			{groups.map((group) => {
				const expanded = isExpanded(group);
				const isInUse = group.key === IN_USE_GROUP_KEY;
				return (
					<div key={group.key}>
						<button
							type="button"
							onClick={() => toggle(group)}
							disabled={isSearching}
							aria-expanded={expanded}
							className={cn(
								"flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent",
								isInUse && "text-emerald-600 dark:text-emerald-400",
							)}
						>
							{expanded ? (
								<ChevronDown size={11} className="shrink-0 opacity-60" />
							) : (
								<ChevronRight size={11} className="shrink-0 opacity-60" />
							)}
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider",
									isInUse ? "" : "text-muted-foreground/70",
								)}
							>
								{group.label}
							</span>
							<span className="shrink-0 text-[10px] text-muted-foreground/60">
								{group.skills.length}
							</span>
						</button>

						{expanded ? (
							<div
								className={cn(isInUse && "rounded-md bg-emerald-500/[0.04]")}
							>
								{group.skills.map((skill) =>
									renderSkill(skill, enabledSkillNames.has(skill.name)),
								)}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
};
