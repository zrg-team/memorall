import React from "react";
import { Badge } from "@/main/components/ui/badge";
import type { SkillSummary } from "@/services/filesystem/skill-filesystem";
import { cn } from "@/lib/utils";

/**
 * Shared skill filtering/labelling helpers.
 *
 * These were private to the agent-config Skills section; the Skills page needs
 * the same behaviour, so they live here and both import them rather than
 * drifting apart in two copies.
 */

export const matchesSkillQuery = (
	skill: SkillSummary,
	query: string,
): boolean => {
	if (!query) return true;

	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return true;

	return [
		skill.name,
		skill.description,
		skill.publisher,
		skill.author,
		skill.collection,
		skill.repo,
		...(skill.tags ?? []),
	]
		.filter(Boolean)
		.some((value) => value!.toLowerCase().includes(normalizedQuery));
};

export const getSkillCategoryLabel = (collection: string): string => {
	const normalized = collection.trim().toLowerCase();
	if (normalized === "design-skills" || normalized.includes("open-design")) {
		return "design";
	}
	return collection;
};

export const getSkillCategoryBadgeClassName = (collection: string): string => {
	const normalized = collection.trim().toLowerCase();

	if (normalized === "design-skills" || normalized.includes("open-design")) {
		return "border-cyan-400/35 bg-cyan-400/10 text-cyan-200";
	}
	if (normalized.includes("engineering")) {
		return "border-blue-400/35 bg-blue-400/10 text-blue-200";
	}
	if (normalized.includes("tooling")) {
		return "border-amber-400/35 bg-amber-400/10 text-amber-200";
	}
	if (normalized.includes("documentation")) {
		return "border-violet-400/35 bg-violet-400/10 text-violet-200";
	}
	if (normalized.includes("api")) {
		return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
	}
	if (normalized.includes("web")) {
		return "border-sky-400/35 bg-sky-400/10 text-sky-200";
	}
	if (normalized.includes("project")) {
		return "border-rose-400/35 bg-rose-400/10 text-rose-200";
	}
	if (normalized.includes("anthropic")) {
		return "border-orange-400/35 bg-orange-400/10 text-orange-200";
	}
	return "border-border/70 bg-muted/40 text-muted-foreground";
};

export const SkillCategoryBadge: React.FC<{ collection: string }> = ({
	collection,
}) => (
	<Badge
		variant="outline"
		className={cn("capitalize", getSkillCategoryBadgeClassName(collection))}
	>
		{getSkillCategoryLabel(collection)}
	</Badge>
);
