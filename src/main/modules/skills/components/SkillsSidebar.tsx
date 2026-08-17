import React from "react";
import { useTranslation } from "react-i18next";
import {
	ChevronDown,
	ChevronRight,
	FileText,
	Folder,
	Image as ImageIcon,
	Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkillsStore, type SkillSelection } from "@/main/stores/skills";
import type {
	SkillResource,
	SkillSummary,
} from "@/services/filesystem/skill-filesystem";
import { SkillGroupList } from "./SkillGroupList";

interface SkillsSidebarProps {
	query: string;
	enabledSkillNames: Set<string>;
	onSelect: (selection: SkillSelection) => void;
	className?: string;
}

const ResourceIcon: React.FC<{ kind: SkillResource["kind"] }> = ({ kind }) => {
	if (kind === "image") return <ImageIcon size={12} className="shrink-0" />;
	return <FileText size={12} className="shrink-0" />;
};

/**
 * One skill row. A folder skill is expandable, so its bundled files are
 * reachable without leaving the page — the SKILL.md standard's progressive
 * disclosure made navigable.
 */
const SkillRow: React.FC<{
	skill: SkillSummary;
	enabled: boolean;
	selected: SkillSelection | null;
	resources: SkillResource[];
	onSelect: (selection: SkillSelection) => void;
}> = ({ skill, enabled, selected, resources, onSelect }) => {
	const { t } = useTranslation("skills");
	const isSelected = selected?.name === skill.name;
	const isFolder = skill.format === "folder";
	const [expanded, setExpanded] = React.useState(false);

	// Opening a folder skill from elsewhere (search, import) should reveal its
	// files rather than leaving the row silently collapsed.
	React.useEffect(() => {
		if (isSelected && isFolder) setExpanded(true);
	}, [isSelected, isFolder]);

	const entrySelected = isSelected && !selected?.resourcePath;

	return (
		<div>
			<div
				className={cn(
					"group flex w-full items-center gap-1 rounded-lg border px-1.5 py-1.5 text-left transition-colors",
					entrySelected
						? "border-blue-500/30 bg-blue-500/10"
						: enabled
							? "border-emerald-500/20 hover:bg-muted/60"
							: "border-transparent hover:bg-muted/60",
				)}
			>
				{isFolder ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="grid h-4 w-4 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
						aria-label={expanded ? t("sidebar.collapse") : t("sidebar.expand")}
					>
						{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
					</button>
				) : (
					<span className="h-4 w-4 shrink-0" />
				)}

				<button
					type="button"
					onClick={() => onSelect({ name: skill.name })}
					className="flex min-w-0 flex-1 items-center gap-1.5"
				>
					<span
						className={cn(
							"h-1.5 w-1.5 shrink-0 rounded-full",
							enabled ? "bg-emerald-500" : "bg-transparent ring-1 ring-border",
						)}
						aria-hidden
					/>
					{isFolder ? (
						<Folder size={12} className="shrink-0 text-muted-foreground" />
					) : null}
					<span
						className={cn(
							"truncate font-mono text-xs",
							enabled && "font-medium text-emerald-700 dark:text-emerald-300",
						)}
					>
						{skill.name}
					</span>
					{skill.readOnly ? (
						<Lock size={10} className="shrink-0 text-muted-foreground/60" />
					) : null}
				</button>
			</div>

			{isFolder && expanded ? (
				<div className="ml-5 border-l border-border/60 pl-2">
					<button
						type="button"
						onClick={() => onSelect({ name: skill.name })}
						className={cn(
							"flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
							entrySelected ? "text-blue-500" : "hover:bg-muted/60",
						)}
					>
						<FileText size={12} className="shrink-0" />
						<span className="truncate font-mono text-[11px]">SKILL.md</span>
					</button>
					{resources.map((resource) => (
						<button
							key={resource.path}
							type="button"
							onClick={() =>
								onSelect({ name: skill.name, resourcePath: resource.path })
							}
							className={cn(
								"flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
								selected?.resourcePath === resource.path && isSelected
									? "text-blue-500"
									: "hover:bg-muted/60",
							)}
						>
							<ResourceIcon kind={resource.kind} />
							<span className="truncate text-[11px] text-muted-foreground">
								{resource.path}
							</span>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
};

export const SkillsSidebar: React.FC<SkillsSidebarProps> = ({
	query,
	enabledSkillNames,
	onSelect,
	className,
}) => {
	const { t } = useTranslation("skills");
	const skills = useSkillsStore((state) => state.skills);
	const selected = useSkillsStore((state) => state.selected);
	const resources = useSkillsStore((state) => state.resources);
	const isLoading = useSkillsStore((state) => state.isLoading);

	if (isLoading && skills.length === 0) {
		return (
			<p className="px-3 py-4 text-xs text-muted-foreground">
				{t("sidebar.loading")}
			</p>
		);
	}

	return (
		<SkillGroupList
			className={className}
			skills={skills}
			query={query}
			enabledSkillNames={enabledSkillNames}
			inUseLabel={t("sidebar.inUse")}
			customLabel={t("sidebar.yours")}
			emptyMessage={query ? t("sidebar.noMatches") : t("sidebar.empty")}
			renderSkill={(skill, enabled) => (
				<SkillRow
					key={skill.name}
					skill={skill}
					enabled={enabled}
					selected={selected}
					resources={selected?.name === skill.name ? resources : []}
					onSelect={onSelect}
				/>
			)}
		/>
	);
};
