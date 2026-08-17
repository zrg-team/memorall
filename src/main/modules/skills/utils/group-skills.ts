import type { SkillSummary } from "@/services/filesystem/skill-filesystem";

/** One left-panel root: a publisher/collection heading and the skills under it. */
export interface SkillGroup {
	key: string;
	label: string;
	skills: SkillSummary[];
	/**
	 * Open on first render. Only the small, user-scoped groups qualify — the
	 * bundled library runs to hundreds of rows, and rendering all of them on
	 * arrival is what made the list slow.
	 */
	defaultExpanded: boolean;
}

export const IN_USE_GROUP_KEY = "__in_use__";
export const CUSTOM_GROUP_KEY = "__custom__";

const groupLabelFor = (skill: SkillSummary): string =>
	skill.collection || skill.publisher || skill.author || "Other";

export interface GroupSkillsOptions {
	inUseLabel: string;
	customLabel: string;
	/** Skills enabled on the agent being edited. */
	enabledNames: Set<string>;
}

/**
 * Groups skills into the sidebar's roots.
 *
 * Order is by what the user acts on: the skills this agent actually uses, then
 * the ones they wrote, then the read-only library by category. A skill appears
 * in exactly one group — an enabled custom skill lives under "In use" only, so
 * toggling it never makes a row jump between two visible lists.
 */
export const groupSkills = (
	skills: SkillSummary[],
	{ inUseLabel, customLabel, enabledNames }: GroupSkillsOptions,
): SkillGroup[] => {
	const groups = new Map<string, SkillGroup>();

	const bucket = (key: string, label: string, defaultExpanded: boolean) => {
		let group = groups.get(key);
		if (!group) {
			group = { key, label, skills: [], defaultExpanded };
			groups.set(key, group);
		}
		return group;
	};

	for (const skill of skills) {
		if (enabledNames.has(skill.name)) {
			bucket(IN_USE_GROUP_KEY, inUseLabel, true).skills.push(skill);
			continue;
		}
		if (skill.origin !== "default") {
			bucket(CUSTOM_GROUP_KEY, customLabel, true).skills.push(skill);
			continue;
		}
		const label = groupLabelFor(skill);
		bucket(label, label, false).skills.push(skill);
	}

	for (const group of groups.values()) {
		group.skills.sort((a, b) => a.name.localeCompare(b.name));
	}

	const rank = (key: string) =>
		key === IN_USE_GROUP_KEY ? 0 : key === CUSTOM_GROUP_KEY ? 1 : 2;

	return [...groups.values()].sort((a, b) => {
		const byRank = rank(a.key) - rank(b.key);
		return byRank !== 0 ? byRank : a.label.localeCompare(b.label);
	});
};
