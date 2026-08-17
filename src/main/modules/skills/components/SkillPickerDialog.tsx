import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Lock, Plus, Search } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { useSkillsStore, type SkillLane } from "@/main/stores/skills";
import type { SkillImportCandidate } from "@/services/filesystem/skill-filesystem";
import { cn } from "@/lib/utils";
import { SkillGroupList } from "./SkillGroupList";
import { AddSkillChooser } from "./AddSkillChooser";
import { SkillImportReview } from "./SkillImportReview";
import { CreateSkillForm, GithubImportForm } from "./SkillLaneForms";
import { useSkillImport } from "../hooks/use-skill-import";

interface SkillPickerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	enabledSkillNames: Set<string>;
	onToggleSkill: (name: string) => void;
}

type Screen = "pick" | "add" | SkillLane | "review";

/**
 * Pick — and add — skills for the agent being configured, in place.
 *
 * Deliberately a dialog rather than a link to the Skills page: this is mounted
 * inside the agent wizard, and navigating away tears down that flow's draft
 * state. Everything the page can do to create a skill is reachable here.
 */
export const SkillPickerDialog: React.FC<SkillPickerDialogProps> = ({
	open,
	onOpenChange,
	enabledSkillNames,
	onToggleSkill,
}) => {
	const { t } = useTranslation(["skills", "common"]);
	const skills = useSkillsStore((state) => state.skills);
	const initialize = useSkillsStore((state) => state.initialize);
	const refresh = useSkillsStore((state) => state.refresh);
	const commitImport = useSkillsStore((state) => state.commitImport);

	const [screen, setScreen] = React.useState<Screen>("pick");
	const [query, setQuery] = React.useState("");
	const [candidates, setCandidates] = React.useState<SkillImportCandidate[]>(
		[],
	);

	const handlePlanned = React.useCallback((planned: SkillImportCandidate[]) => {
		setCandidates(planned);
		setScreen("review");
	}, []);
	const { isPlanning, pickFiles } = useSkillImport(handlePlanned);

	React.useEffect(() => {
		if (open) void initialize();
	}, [open, initialize]);

	React.useEffect(() => {
		if (!open) {
			setScreen("pick");
			setQuery("");
			setCandidates([]);
		}
	}, [open]);

	const existingNames = React.useMemo(
		() => new Set(skills.map((skill) => skill.name)),
		[skills],
	);

	const startLane = (lane: SkillLane) => {
		if (lane === "upload" || lane === "folder") {
			pickFiles(lane === "folder");
			return;
		}
		setScreen(lane);
	};

	const renderBody = () => {
		if (screen === "review" || isPlanning) {
			return (
				<SkillImportReview
					candidates={candidates}
					existingNames={existingNames}
					onCancel={() => setScreen("pick")}
					onConfirm={async (selected) => {
						await commitImport(selected);
						// Enable what was just imported: adding a skill from inside the
						// agent config is a request to use it, not just to store it.
						for (const candidate of selected) {
							if (!enabledSkillNames.has(candidate.name)) {
								onToggleSkill(candidate.name);
							}
						}
						setScreen("pick");
					}}
				/>
			);
		}

		if (screen === "manual") {
			return (
				<CreateSkillForm
					onBack={() => setScreen("add")}
					onCreated={async (name) => {
						await refresh();
						if (!enabledSkillNames.has(name)) onToggleSkill(name);
						setScreen("pick");
					}}
				/>
			);
		}

		if (screen === "github") {
			return (
				<GithubImportForm
					onBack={() => setScreen("add")}
					onPlanned={handlePlanned}
				/>
			);
		}

		if (screen === "add") {
			return (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="mb-3 flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={() => setScreen("pick")}
							aria-label={t("buttons.back", { ns: "common" })}
						>
							<ArrowLeft size={14} />
						</Button>
						<div>
							<h2 className="text-sm font-semibold">{t("empty.title")}</h2>
							<p className="text-[11px] text-muted-foreground">
								{t("picker.addSubtitle")}
							</p>
						</div>
					</div>
					<AddSkillChooser onSelect={startLane} compact />
				</div>
			);
		}

		return (
			<>
				<div className="shrink-0 border-b px-4 py-3">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("searchPlaceholder")}
							className="h-8 pl-8 text-xs"
						/>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<SkillGroupList
						skills={skills}
						query={query}
						enabledSkillNames={enabledSkillNames}
						inUseLabel={t("sidebar.inUse")}
						customLabel={t("sidebar.yours")}
						emptyMessage={query ? t("sidebar.noMatches") : t("sidebar.empty")}
						renderSkill={(skill, enabled) => (
							<div
								key={skill.name}
								className={cn(
									"flex items-center gap-2 rounded-lg border px-2 py-1.5",
									enabled ? "border-emerald-500/20" : "border-transparent",
								)}
							>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-1.5">
										<span
											className={cn(
												"truncate font-mono text-xs",
												enabled &&
													"font-medium text-emerald-700 dark:text-emerald-300",
											)}
										>
											{skill.name}
										</span>
										{skill.readOnly ? (
											<Lock
												size={10}
												className="shrink-0 text-muted-foreground/60"
											/>
										) : null}
									</span>
									{skill.description ? (
										<span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
											{skill.description}
										</span>
									) : null}
								</span>
								<Button
									type="button"
									size="sm"
									variant={enabled ? "secondary" : "outline"}
									className="h-6 shrink-0 px-2 text-[11px]"
									onClick={() => onToggleSkill(skill.name)}
								>
									{enabled ? t("picker.remove") : t("picker.use")}
								</Button>
							</div>
						)}
					/>
				</div>
				<div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
					<span className="text-[11px] text-muted-foreground">
						{t("picker.enabledCount", { count: enabledSkillNames.size })}
					</span>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => setScreen("add")}
					>
						<Plus size={12} className="mr-1.5" />
						{t("add")}
					</Button>
				</div>
			</>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[min(88dvh,760px)] w-[calc(100vw-1rem)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:w-[min(94vw,760px)]">
				<DialogHeader className="shrink-0 border-b px-4 pb-3 pt-4">
					<DialogTitle className="text-sm">{t("picker.title")}</DialogTitle>
				</DialogHeader>
				{renderBody()}
			</DialogContent>
		</Dialog>
	);
};
