import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useSkillsStore } from "@/main/stores/skills";
import { SkillPickerDialog } from "@/main/modules/skills";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";

/**
 * Which skills this agent uses.
 *
 * Picking and adding both happen in a dialog on top of this page. Sending the
 * user to the Skills page instead would unmount the agent wizard and lose the
 * draft they are part-way through, so the whole flow stays here.
 */
export const SkillsSection: React.FC = () => {
	const { t } = useTranslation(["agents", "common"]);
	const skills = useSkillsStore((state) => state.skills);
	const initialize = useSkillsStore((state) => state.initialize);
	const isLoading = useSkillsStore((state) => state.isLoading);
	const draftEnabledSkillNames = useAgentConfigStore(
		(state) => state.draftEnabledSkillNames,
	);
	const toggleSkill = useAgentConfigStore((state) => state.toggleSkill);

	const [pickerOpen, setPickerOpen] = useState(false);

	useEffect(() => {
		void initialize();
	}, [initialize]);

	const enabledSkillNameSet = useMemo(
		() => new Set(draftEnabledSkillNames),
		[draftEnabledSkillNames],
	);
	const enabledSkills = useMemo(
		() =>
			skills
				.filter((skill) => enabledSkillNameSet.has(skill.name))
				.sort((a, b) => {
					if (a.origin !== b.origin) {
						return a.origin === "default" ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				}),
		[enabledSkillNameSet, skills],
	);
	const visibleEnabledSkills = enabledSkills.slice(0, 6);
	const hiddenSkillCount = Math.max(
		enabledSkills.length - visibleEnabledSkills.length,
		0,
	);

	return (
		<>
			<CursorPoint
				cursorKey={AGENT_WIZARD_CURSOR_KEYS.skills}
				className="flex min-h-[32px] items-center gap-3"
			>
				<span
					className="w-20 shrink-0 text-sm text-muted-foreground"
					title={t("skills.memoryHint", { ns: "agents" })}
				>
					{t("skills.label", { ns: "agents" })}
				</span>

				<div className="flex flex-wrap items-center gap-1.5">
					{isLoading && skills.length === 0 ? (
						<span className="text-[11px] text-muted-foreground/50">…</span>
					) : enabledSkills.length === 0 ? (
						<span className="text-[11px] text-muted-foreground">
							{t("skills.noneEnabled", { ns: "agents" })}
						</span>
					) : (
						<>
							{visibleEnabledSkills.map((skill) => (
								<button
									key={skill.name}
									type="button"
									onClick={() => setPickerOpen(true)}
									className="flex items-center rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
								>
									{skill.name}
								</button>
							))}
							{hiddenSkillCount > 0 ? (
								<span className="rounded-lg border border-dashed border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
									+{hiddenSkillCount}
								</span>
							) : null}
						</>
					)}
					<button
						type="button"
						onClick={() => setPickerOpen(true)}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						<Plus size={12} />
						{t("skills.manageAction", { ns: "agents" })}
					</button>
				</div>
			</CursorPoint>

			<SkillPickerDialog
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				enabledSkillNames={enabledSkillNameSet}
				onToggleSkill={toggleSkill}
			/>
		</>
	);
};
