import React from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, Loader2, Search } from "lucide-react";
import { Input } from "@/main/components/ui/input";
import { PageHeader } from "@/main/components/ui/page-header";
import {
	AddSkillButton,
	AddSkillChooser,
	CreateSkillForm,
	GithubImportForm,
	SkillDetail,
	SkillImportReview,
	SkillsSidebar,
	useSkillImport,
} from "@/main/modules/skills";
import { useSkillsStore } from "@/main/stores/skills";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useChatStore } from "@/main/stores/chat";
import { cn } from "@/lib/utils";

/**
 * Sidebar of skills plus a detail pane, matching the Connections and Models
 * workspace views. The chooser doubles as the empty state and as the "add"
 * screen, so there is one place that explains the four ways in.
 */
export const SkillsPage: React.FC = () => {
	const { t } = useTranslation("skills");

	const skills = useSkillsStore((state) => state.skills);
	const selected = useSkillsStore((state) => state.selected);
	const lane = useSkillsStore((state) => state.lane);
	const pendingImport = useSkillsStore((state) => state.pendingImport);
	const isLoading = useSkillsStore((state) => state.isLoading);
	const initialize = useSkillsStore((state) => state.initialize);
	const refresh = useSkillsStore((state) => state.refresh);
	const select = useSkillsStore((state) => state.select);
	const openLane = useSkillsStore((state) => state.openLane);
	const setPendingImport = useSkillsStore((state) => state.setPendingImport);
	const commitImport = useSkillsStore((state) => state.commitImport);

	const enabledSkillNames = useAgentConfigStore(
		(state) => state.draftEnabledSkillNames,
	);
	const toggleSkill = useAgentConfigStore((state) => state.toggleSkill);
	const availableAgents = useAgentConfigStore((state) => state.availableAgents);
	const selectedAgentFlowId = useChatStore(
		(state) => state.selectedAgentFlowId,
	);

	const [query, setQuery] = React.useState("");
	const [isDragging, setIsDragging] = React.useState(false);
	const { isPlanning, pickFiles, planFromDrop } =
		useSkillImport(setPendingImport);

	React.useEffect(() => {
		void initialize();
	}, [initialize]);

	const enabledSet = React.useMemo(
		() => new Set(enabledSkillNames),
		[enabledSkillNames],
	);
	const existingNames = React.useMemo(
		() => new Set(skills.map((skill) => skill.name)),
		[skills],
	);
	const agentName =
		availableAgents.find((agent) => agent.id === selectedAgentFlowId)?.name ??
		t("detail.defaultAgentName");

	const isEmpty = skills.length === 0;

	// The upload/folder lanes have no screen of their own — they open the OS
	// picker and hand whatever comes back straight to the review step.
	React.useEffect(() => {
		if (lane === "upload" || lane === "folder") {
			pickFiles(lane === "folder");
			openLane(null);
		}
	}, [lane, openLane, pickFiles]);

	const handleDrop = async (event: React.DragEvent) => {
		event.preventDefault();
		setIsDragging(false);
		await planFromDrop([...event.dataTransfer.files]);
	};

	// ── Main pane ────────────────────────────────────────────────────────────

	const renderMain = () => {
		if (isPlanning || (isLoading && isEmpty)) {
			return (
				<div className="flex flex-1 items-center justify-center">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			);
		}

		if (pendingImport) {
			return (
				<SkillImportReview
					candidates={pendingImport}
					existingNames={existingNames}
					onCancel={() => setPendingImport(null)}
					onConfirm={commitImport}
				/>
			);
		}

		if (lane === "manual") {
			return (
				<CreateSkillForm
					onBack={() => openLane(null)}
					onCreated={async (name) => {
						await refresh();
						await select({ name });
					}}
				/>
			);
		}

		if (lane === "github") {
			return (
				<GithubImportForm
					onBack={() => openLane(null)}
					onPlanned={setPendingImport}
				/>
			);
		}

		if (selected) {
			return (
				<SkillDetail
					enabled={enabledSet.has(selected.name)}
					agentName={agentName}
					onToggleEnabled={toggleSkill}
				/>
			);
		}

		return (
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<div className="mx-auto max-w-3xl space-y-4">
					<div>
						<h2 className="text-base font-semibold">{t("empty.title")}</h2>
						<p className="mt-1 max-w-xl text-sm text-muted-foreground">
							{t("empty.body")}
						</p>
					</div>
					<AddSkillChooser onSelect={openLane} />
				</div>
			</div>
		);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[264px_1fr]">
				<aside className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
					<PageHeader
						icon={<GraduationCap size={18} />}
						title={t("title")}
						description={
							isEmpty
								? t("descriptionEmpty")
								: t("description", {
										count: skills.length,
										enabled: enabledSet.size,
									})
						}
					/>
					<div className="space-y-2 px-2 pt-2">
						<AddSkillButton onClick={() => openLane(null)} />
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
						<SkillsSidebar
							query={query}
							enabledSkillNames={enabledSet}
							onSelect={(selection) => void select(selection)}
						/>
					</div>
				</aside>

				<main
					className={cn(
						"relative flex min-h-0 flex-col overflow-hidden",
						isDragging &&
							"outline-dashed outline-2 -outline-offset-4 outline-blue-500/50",
					)}
					onDragOver={(event) => {
						event.preventDefault();
						setIsDragging(true);
					}}
					onDragLeave={(event) => {
						if (
							event.currentTarget.contains(
								event.relatedTarget as globalThis.Node,
							)
						)
							return;
						setIsDragging(false);
					}}
					onDrop={(event) => void handleDrop(event)}
				>
					{isDragging ? (
						<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80">
							<p className="text-sm font-medium text-blue-500">
								{t("empty.dropHint")}
							</p>
						</div>
					) : null}
					{renderMain()}
				</main>
			</div>
		</div>
	);
};
