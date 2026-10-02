import React, { useEffect, useMemo, useRef, useState } from "react";
import {
	Check,
	ChevronDown,
	Code2,
	Eye,
	FileText,
	Play,
	Save,
	Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Button } from "@/main/components/ui/button";
import { PageHeader } from "@/main/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/main/components/ui/tabs";
import { Textarea } from "@/main/components/ui/textarea";
import { RuntimeSessionsSectionList } from "@/main/components/molecules/RuntimeSessions/RuntimeSessionsSectionList";
import {
	MemonComputerPanel,
	MemonComputerStart,
	useMemonAgents,
} from "@/main/components/molecules/MemonComputer";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import { useChatStore } from "@/main/stores/chat";
import MarkdownMessage from "@/main/modules/chat/components/MarkdownMessage";
import { UrlArtifact } from "@/main/modules/chat/components/artifacts/ArtifactRenderer";
import { HyperframesArtifact } from "@/main/modules/chat/components/artifacts/HyperframesArtifact";
import { LottieArtifact } from "@/main/modules/chat/components/artifacts/LottieArtifact";
import {
	collectRuntimeArtifacts,
	replaceArtifactContent,
	type RuntimeArtifact,
} from "@/main/modules/chat/components/artifacts/artifact-protocol";
import { HtmlArtifactFrame } from "@/main/modules/chat/components/artifacts/HtmlArtifactFrame";
import {
	findRuntimeArtifact,
	readRuntimeArtifactTarget,
} from "@/main/modules/chat/components/artifacts/runtime-artifact-state";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";

const HTML_LAZY_RENDER_THRESHOLD = 500_000;

type RuntimeSection = "artifacts" | "runtime" | "computer";

const wantsComputerSection = (state: unknown): boolean =>
	typeof state === "object" &&
	state !== null &&
	(state as { section?: unknown }).section === "computer";
type ArtifactMode = "preview" | "code" | "edit";
type SaveState = "idle" | "saving" | "saved" | "error";

const getArtifactTitle = (artifact: RuntimeArtifact, index: number) =>
	artifact.title?.trim() ||
	artifact.identifier?.trim() ||
	`${artifact.type.toUpperCase()} artifact ${index + 1}`;

const getArtifactSummary = (artifact: RuntimeArtifact) => {
	const trimmed = artifact.content.trim().replace(/\s+/g, " ");
	return trimmed || "Empty artifact";
};

const getArtifactTypeLabel = (type: RuntimeArtifact["type"]) => {
	switch (type) {
		case "html":
			return "Interactive HTML";
		case "markdown":
			return "Markdown draft";
		case "text":
			return "Text note";
		case "url":
			return "Web preview";
		case "hyperframes":
			return "HyperFrames";
		case "lottie":
			return "Lottie animation";
		default:
			return "Artifact";
	}
};

const RuntimeArtifactViewer: React.FC<{
	artifact: RuntimeArtifact;
	index: number;
	onSave: (artifact: RuntimeArtifact, content: string) => Promise<void>;
}> = ({ artifact, index, onSave }) => {
	const [mode, setMode] = useState<ArtifactMode>(
		artifact.type === "html" ||
			artifact.type === "url" ||
			artifact.type === "hyperframes" ||
			artifact.type === "lottie"
			? "preview"
			: "edit",
	);
	const [draft, setDraft] = useState(artifact.content);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [renderConfirmed, setRenderConfirmed] = useState(
		artifact.type !== "html" ||
			artifact.content.length <= HTML_LAZY_RENDER_THRESHOLD,
	);
	const isEditable = artifact.type !== "url" && artifact.source === "content";
	const isDirty = draft !== artifact.content;

	useEffect(() => {
		setDraft(artifact.content);
		setSaveState("idle");
		setRenderConfirmed(
			artifact.type !== "html" ||
				artifact.content.length <= HTML_LAZY_RENDER_THRESHOLD,
		);
		setMode((current) => {
			if (artifact.type === "url") return "preview";
			if (artifact.type === "html" || artifact.type === "hyperframes") {
				return current === "code" ? "code" : "preview";
			}
			if (artifact.type === "lottie") {
				return current === "edit" ? "edit" : "preview";
			}
			return current === "preview" ? "preview" : "edit";
		});
	}, [artifact.id, artifact.content, artifact.type]);

	const handleSave = async () => {
		if (!isEditable || saveState === "saving") return;
		setSaveState("saving");
		try {
			await onSave(artifact, draft);
			setSaveState("saved");
			window.setTimeout(() => setSaveState("idle"), 1600);
		} catch {
			setSaveState("error");
		}
	};

	const title = getArtifactTitle(artifact, index);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-shrink-0 items-center justify-between gap-3 border-b bg-muted/10 px-5 py-3.5">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-foreground">
						{title}
					</div>
					<div className="mt-1 text-xs font-medium text-muted-foreground">
						{getArtifactTypeLabel(artifact.type)}
					</div>
				</div>
				<div className="flex flex-shrink-0 items-center gap-2">
					{artifact.type === "html" || artifact.type === "hyperframes" ? (
						<div className="flex rounded-lg border border-border/70 bg-background/70 p-0.5 shadow-sm">
							<Button
								type="button"
								variant={mode === "preview" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
								onClick={() => setMode("preview")}
							>
								<Eye size={13} />
								View
							</Button>
							<Button
								type="button"
								variant={mode === "code" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
								onClick={() => setMode("code")}
							>
								<Code2 size={13} />
								Source
							</Button>
						</div>
					) : null}
					{artifact.type === "markdown" || artifact.type === "lottie" ? (
						<div className="flex rounded-lg border border-border/70 bg-background/70 p-0.5 shadow-sm">
							<Button
								type="button"
								variant={mode === "preview" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
								onClick={() => setMode("preview")}
							>
								<Eye size={13} />
								View
							</Button>
							<Button
								type="button"
								variant={mode === "edit" ? "secondary" : "ghost"}
								size="sm"
								className="h-8 gap-1.5 rounded-md px-3 text-xs font-medium"
								onClick={() => setMode("edit")}
							>
								<Code2 size={13} />
								Edit
							</Button>
						</div>
					) : null}
					{isEditable ? (
						<Button
							type="button"
							size="sm"
							className="h-8 gap-1.5 rounded-md px-3 font-medium"
							disabled={!isDirty || saveState === "saving"}
							onClick={handleSave}
						>
							{saveState === "saved" ? <Check size={14} /> : <Save size={14} />}
							{saveState === "saving"
								? "Saving..."
								: saveState === "saved"
									? "Saved"
									: "Save changes"}
						</Button>
					) : null}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto bg-background">
				{artifact.type === "url" ? (
					<div className="p-3">
						<UrlArtifact content={artifact.content} title={title} />
					</div>
				) : artifact.type === "html" && mode === "preview" ? (
					renderConfirmed ? (
						<HtmlArtifactFrame
							html={draft}
							projectPath={artifact.projectPath}
							className="h-full min-h-[420px] w-full bg-white"
							title={title}
						/>
					) : (
						<div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/70 bg-muted/30">
								<Eye size={22} className="text-muted-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium text-foreground">
									Large HTML document
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{(draft.length / 1024).toFixed(0)} KB — click to render the
									preview
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								className="gap-1.5"
								onClick={() => setRenderConfirmed(true)}
							>
								<Play size={13} />
								Render preview
							</Button>
						</div>
					)
				) : artifact.type === "hyperframes" && mode === "preview" ? (
					<HyperframesArtifact
						content={draft}
						identifier={artifact.identifier}
						title={title}
					/>
				) : artifact.type === "lottie" && mode === "preview" ? (
					<LottieArtifact
						content={draft}
						identifier={artifact.identifier}
						title={title}
					/>
				) : artifact.type === "markdown" && mode === "preview" ? (
					<div className="mx-auto max-w-3xl p-5">
						<MarkdownMessage>{draft}</MarkdownMessage>
					</div>
				) : (
					<Textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						spellCheck={artifact.type !== "html"}
						className={cn(
							"h-full min-h-[420px] resize-none rounded-none border-0 bg-background p-4 text-sm leading-relaxed shadow-none focus-visible:ring-0",
							artifact.type === "html" || artifact.type === "text"
								? "font-mono"
								: "font-sans",
						)}
					/>
				)}
			</div>

			{saveState === "error" ? (
				<div className="flex-shrink-0 border-t px-4 py-2 text-xs text-destructive">
					Failed to save artifact changes.
				</div>
			) : null}
		</div>
	);
};

export const RuntimePage: React.FC = () => {
	const { t } = useTranslation();
	const commands = useRuntimeSessionsStore((state) => state.commands);
	const servers = useRuntimeSessionsStore((state) => state.servers);
	const activeWebSession = useRuntimeSessionsStore(
		(state) => state.activeWebSession,
	);
	const refreshRuntimeSessions = useRuntimeSessionsStore(
		(state) => state.refresh,
	);
	const messages = useChatStore((state) => state.messages);
	const persistMessageContent = useChatStore(
		(state) => state.persistMessageContent,
	);
	const location = useLocation();
	const chatAgentId = useChatStore((state) => state.selectedAgentFlowId);
	const memonSummaries = useMemonMachineStore((state) => state.summaries);
	const memonSnapshots = useMemonMachineStore((state) => state.snapshots);
	const startMemon = useMemonMachineStore((state) => state.start);
	const { agents: memonAgents, loading: memonAgentsLoading } = useMemonAgents();
	// The chat agent's computer: a computer belongs to its agent, whatever the
	// chat. For an agent without MemonOS Bot, the most recently active one.
	const memonKey = useMemo(() => {
		const running =
			chatAgentId !== null &&
			Boolean(memonSummaries[chatAgentId] || memonSnapshots[chatAgentId]);
		if (chatAgentId && running) return chatAgentId;
		if (memonAgents.some((agent) => agent.id === chatAgentId)) return null;
		const latest = Object.values(memonSummaries).sort(
			(a, b) => b.updatedAt - a.updatedAt,
		)[0];
		return latest?.key ?? null;
	}, [chatAgentId, memonAgents, memonSummaries, memonSnapshots]);
	// Any agent with MemonOS Bot can have its computer started from here.
	const hasComputer =
		memonKey !== null ||
		memonAgents.length > 0 ||
		wantsComputerSection(location.state);
	const artifacts = useMemo(
		() => collectRuntimeArtifacts(messages),
		[messages],
	);
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
		null,
	);
	const [artifactListOpen, setArtifactListOpen] = useState(true);
	const hasRuntime =
		Boolean(platform.browserAutomation) ||
		commands.length > 0 ||
		servers.length > 0 ||
		activeWebSession.isOpen;
	const hasArtifacts = artifacts.length > 0;
	const [section, setSection] = useState<RuntimeSection>(
		wantsComputerSection(location.state)
			? "computer"
			: hasArtifacts
				? "artifacts"
				: "runtime",
	);

	useEffect(() => {
		void refreshRuntimeSessions();
	}, [refreshRuntimeSessions]);

	useEffect(() => {
		startMemon();
	}, [startMemon]);

	useEffect(() => {
		if (wantsComputerSection(location.state)) setSection("computer");
	}, [location.state]);

	useEffect(() => {
		// The Computer tab is chosen explicitly; new artifacts must not steal it.
		if (section === "computer") return;
		if (hasArtifacts) {
			const selectedExists = artifacts.some(
				(artifact) => artifact.id === selectedArtifactId,
			);
			if (!selectedExists) {
				setSelectedArtifactId(artifacts.at(-1)?.id ?? null);
				setSection("artifacts");
			}
			return;
		}

		setSelectedArtifactId(null);
		setSection("runtime");
	}, [artifacts, hasArtifacts, selectedArtifactId, section]);

	// An artifact a message pointed at: shown once per click, so picking
	// another one afterwards sticks.
	const shownTargetRef = useRef<string | null>(null);
	useEffect(() => {
		const target = readRuntimeArtifactTarget(location.state);
		if (!target || shownTargetRef.current === location.key) return;
		const artifact = findRuntimeArtifact(artifacts, target);
		if (!artifact) return;
		shownTargetRef.current = location.key;
		setSelectedArtifactId(artifact.id);
		setSection("artifacts");
	}, [artifacts, location.key, location.state]);

	// A chat with a MemonOS Bot agent opens on its computer, once, unless there
	// are outputs to show. Runs after the effect above so it wins on mount.
	const landedOnComputerRef = useRef(false);
	useEffect(() => {
		if (landedOnComputerRef.current || memonAgentsLoading) return;
		landedOnComputerRef.current = true;
		if (hasArtifacts) return;
		if (
			memonKey !== null ||
			memonAgents.some((agent) => agent.id === chatAgentId)
		) {
			setSection("computer");
		}
	}, [chatAgentId, hasArtifacts, memonAgents, memonAgentsLoading, memonKey]);

	const selectedArtifact =
		artifacts.find((artifact) => artifact.id === selectedArtifactId) ??
		artifacts.at(-1) ??
		null;
	const selectedArtifactIndex = selectedArtifact
		? artifacts.findIndex((artifact) => artifact.id === selectedArtifact.id)
		: -1;

	const handleSaveArtifact = async (
		artifact: RuntimeArtifact,
		content: string,
	) => {
		const nextMessageContent = replaceArtifactContent(
			artifact.messageContent,
			artifact.blockIndex,
			content,
		);
		await persistMessageContent(artifact.messageId, nextMessageContent);
	};

	// Live Runtime is also the empty fallback when there are no outputs, so it
	// keeps a tab next to Computer even before anything runs.
	const showRuntimeTab = hasRuntime || (hasComputer && !hasArtifacts);
	const sectionCount =
		Number(hasArtifacts) + Number(showRuntimeTab) + Number(hasComputer);
	const showSectionTabs = sectionCount > 1;

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<PageHeader
				icon={<Server size={18} />}
				title={t("sandboxPanel.title")}
				description={t("sandboxPanel.description", {
					defaultValue:
						"Preview generated work, live pages, servers, and command activity.",
				})}
				actionsPlacement="title"
				actions={
					showSectionTabs ? (
						<Tabs
							value={section}
							onValueChange={(value) => setSection(value as RuntimeSection)}
						>
							<TabsList className="h-9">
								{hasArtifacts ? (
									<TabsTrigger value="artifacts" className="px-4">
										{t("sandboxPanel.outputsTab", { defaultValue: "Outputs" })}
									</TabsTrigger>
								) : null}
								{showRuntimeTab ? (
									<TabsTrigger value="runtime" className="px-4">
										{t("sandboxPanel.liveRuntimeTab", {
											defaultValue: "Live Runtime",
										})}
									</TabsTrigger>
								) : null}
								{hasComputer ? (
									<TabsTrigger value="computer" className="px-4">
										{t("sandboxPanel.computerTab", {
											defaultValue: "Computer",
										})}
									</TabsTrigger>
								) : null}
							</TabsList>
						</Tabs>
					) : undefined
				}
			/>

			<div className="min-h-0 flex-1">
				{section === "computer" ? (
					<MemonComputerPanel
						machineKey={memonKey}
						emptyState={
							<MemonComputerStart
								agents={memonAgents}
								loading={memonAgentsLoading}
							/>
						}
					/>
				) : section === "artifacts" && selectedArtifact ? (
					<div className="flex h-full min-h-0">
						{artifacts.length > 1 ? (
							<aside className="flex h-full w-56 flex-shrink-0 flex-col border-r bg-muted/10">
								<button
									type="button"
									className="flex items-center justify-between gap-2 border-b px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground"
									onClick={() => setArtifactListOpen((open) => !open)}
								>
									<span>Generated outputs ({artifacts.length})</span>
									<ChevronDown
										size={14}
										className={cn(
											"transition-transform",
											artifactListOpen && "rotate-180",
										)}
									/>
								</button>
								{artifactListOpen ? (
									<div className="min-h-0 flex-1 overflow-y-auto p-2">
										{artifacts.map((artifact, index) => {
											const selected = artifact.id === selectedArtifact.id;
											return (
												<button
													key={artifact.id}
													type="button"
													className={cn(
														"mb-1 flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
														selected
															? "bg-blue-500/10 text-blue-500"
															: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
													)}
													onClick={() => setSelectedArtifactId(artifact.id)}
												>
													<FileText
														size={14}
														className="mt-0.5 flex-shrink-0"
													/>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-xs font-medium">
															{getArtifactTitle(artifact, index)}
														</span>
														<span className="mt-0.5 block truncate text-[11px] opacity-75">
															{getArtifactTypeLabel(artifact.type)} -{" "}
															{getArtifactSummary(artifact)}
														</span>
													</span>
												</button>
											);
										})}
									</div>
								) : null}
							</aside>
						) : null}
						<div className="min-w-0 flex-1">
							<RuntimeArtifactViewer
								artifact={selectedArtifact}
								index={Math.max(0, selectedArtifactIndex)}
								onSave={handleSaveArtifact}
							/>
						</div>
					</div>
				) : hasRuntime ? (
					<div className="h-full overflow-y-auto p-4">
						<RuntimeSessionsSectionList
							commands={commands}
							servers={servers}
							activeWebSession={activeWebSession}
							onRefresh={refreshRuntimeSessions}
							variant="docked"
						/>
					</div>
				) : (
					<div className="flex h-full items-center justify-center p-4">
						<div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
							{t("sandboxPanel.empty", {
								defaultValue: "No active runtime sessions",
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
