import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { AlertTriangle, ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import {
	AddConnectionChooser,
	AppIcon,
	ComposioWizard,
	type ConnectionLane,
	ConnectionIcon,
	CustomEndpointForm,
	StatusDot,
} from "@/main/modules/connections";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useConnectionsStore } from "@/main/stores/connections";
import { ensureComposioHostAccess } from "@/services/composio";
import {
	isProviderSelected,
	listProviderOptions,
	type McpConnection,
	prepareConnectionScopes,
	type ProviderOption,
	type ScopeProblem,
	toggleProvider,
} from "@/services/mcp-connections";

/** Past this, tool choice measurably degrades — worth saying out loud. */
const BUSY_TOOLBOX = 25;
const CROWDED_TOOLBOX = 50;

const KindIcon: React.FC<{ kind: McpConnection["kind"] }> = ({ kind }) => (
	<ConnectionIcon kind={kind} size={20} />
);

const Switch: React.FC<{ on: boolean }> = ({ on }) => (
	<span
		className={cn(
			"relative h-4 w-7 shrink-0 rounded-full transition-colors",
			on ? "bg-blue-500" : "bg-muted",
		)}
	>
		<span
			className={cn(
				"absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all",
				on ? "left-3.5" : "left-0.5",
			)}
		/>
	</span>
);

/**
 * Grants an agent individual providers — "GitHub", "Google Calendar" — rather
 * than whole credentials. A Composio account holds many apps, and attaching it
 * wholesale would give the agent every app on it plus anything authorized
 * later, which is never what someone means by "this agent reads my calendar".
 *
 * Nothing is on by default. What is switched on here is the entire reach of the
 * agent, and for Composio it is enforced by a session minted for exactly these
 * toolkits rather than by hiding tools from a list.
 */
export const MCPServersModal = NiceModal.create(() => {
	const modal = useModal();
	const { t } = useTranslation(["connections", "agents"]);

	const draftConnections = useAgentConfigStore(
		(state) => state.draftConnections,
	);
	const setAgentConnections = useAgentConfigStore(
		(state) => state.setAgentConnections,
	);
	const save = useAgentConfigStore((state) => state.save);
	const isSaving = useAgentConfigStore((state) => state.isSaving);

	const connections = useConnectionsStore((state) => state.connections);
	const initialize = useConnectionsStore((state) => state.initialize);
	const statusOf = useConnectionsStore((state) => state.statusOf);
	const toolsOf = useConnectionsStore((state) => state.toolsOf);

	const [problems, setProblems] = React.useState<ScopeProblem[]>([]);
	const [checking, setChecking] = React.useState(false);

	/**
	 * Setup runs inside this modal rather than sending the user to the
	 * Connections page: leaving loses the unsaved agent form, and "grant an app
	 * you have not connected yet" is a dead end otherwise. `"chooser"` is the
	 * lane picker itself.
	 */
	const [lane, setLane] = React.useState<ConnectionLane | "chooser" | null>(
		null,
	);
	// The same Composio lane is reached from "Add connection" and from "Add app";
	// the header should say which one the user pressed.
	const [laneIsAddApp, setLaneIsAddApp] = React.useState(false);

	const openLane = (next: ConnectionLane | "chooser", isAddApp = false) => {
		setLaneIsAddApp(isAddApp);
		setLane(next);
	};

	React.useEffect(() => {
		void initialize();
	}, [initialize]);

	const options = React.useMemo(
		() => listProviderOptions(connections),
		[connections],
	);

	const toggle = (option: ProviderOption) => {
		setProblems([]);
		setAgentConnections(toggleProvider(draftConnections, option));
	};

	// "incomplete" means setup never produced an endpoint, so granting it would
	// attach a provider that resolves to nothing at run time.
	const unusableStatus = (id: string) => {
		const status = statusOf(id);
		return status === "bridge-down" ||
			status === "error" ||
			status === "incomplete"
			? status
			: null;
	};

	const selectedCount = options.filter((option) =>
		isProviderSelected(draftConnections, option),
	).length;

	// A Composio session exposes the same six router tools whatever it is scoped
	// to, so the toolbox size is counted per connection, not per provider.
	const totalTools = draftConnections.reduce(
		(total, selection) => total + toolsOf(selection.connectionId).length,
		0,
	);

	const done = async () => {
		// Persist here rather than only mutating the draft: a picker that closes
		// on an unsaved selection is indistinguishable from one that worked.
		await save();

		// Composio mints a session per granted app-set, and that can fail — a
		// read-only project key cannot create sessions at all. Doing it here
		// rather than only at run time means the user learns now, instead of
		// wondering later why the agent has no tools.
		setChecking(true);
		try {
			// Minting needs the Composio host, which Chrome can be withholding.
			// This click is the gesture that lets us ask for it; without asking,
			// every session below fails as an unexplained "Failed to fetch".
			const grantsComposio = draftConnections.some((selection) =>
				connections.some(
					(connection) =>
						connection.id === selection.connectionId &&
						connection.kind === "composio",
				),
			);
			if (grantsComposio) await ensureComposioHostAccess();
			const found = await prepareConnectionScopes(draftConnections);
			setProblems(found);
			// Only hold the modal open the first time, so a warning explains the
			// problem without trapping anyone who has decided to live with it.
			if (found.length === 0 || problems.length > 0) modal.hide();
		} finally {
			setChecking(false);
		}
	};

	if (lane) {
		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => !open && modal.hide()}
			>
				<DialogContent className="flex max-h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-2xl border-border/60 p-0 shadow-2xl sm:w-[min(94vw,720px)]">
					<DialogHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 pb-3 pt-4">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0"
							onClick={() => setLane(null)}
							aria-label={t("connections:composio.cancel")}
						>
							<ArrowLeft size={14} />
						</Button>
						<DialogTitle className="text-base">
							{laneIsAddApp
								? t("connections:agent.addApp")
								: t("connections:add")}
						</DialogTitle>
					</DialogHeader>

					<div className="min-h-0 flex-1 overflow-y-auto p-4">
						{lane === "chooser" ? (
							<AddConnectionChooser
								compact
								onSelect={(next) => openLane(next)}
							/>
						) : lane === "composio" ? (
							<ComposioWizard
								onDone={() => setLane(null)}
								onCancel={() => setLane(null)}
							/>
						) : lane === "custom" ? (
							<CustomEndpointForm
								onSaved={() => setLane(null)}
								onCancel={() => setLane(null)}
							/>
						) : (
							// The local-server lane is not built; say so and offer the one
							// that reaches the same servers rather than stranding anyone.
							<div className="flex flex-col items-center gap-3 py-10 text-center">
								<p className="text-sm font-semibold">
									{t("connections:lanes.template.notBuiltTitle")}
								</p>
								<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
									{t("connections:lanes.template.notBuiltBody")}
								</p>
								<Button
									type="button"
									size="sm"
									onClick={() => openLane("custom")}
								>
									{t("connections:lanes.custom.action")}
								</Button>
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
			<DialogContent className="flex max-h-[min(90dvh,720px)] w-[calc(100vw-1rem)] max-w-[560px] flex-col gap-0 overflow-hidden rounded-2xl border-border/60 p-0 shadow-2xl sm:w-[min(94vw,560px)]">
				<DialogHeader className="border-b px-5 pb-3 pt-4">
					<DialogTitle className="text-base">
						{t("connections:agent.providersTitle")}
					</DialogTitle>
					<p className="text-xs text-muted-foreground">
						{t("connections:agent.providersSubtitle")}
					</p>
				</DialogHeader>

				{connections.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-12 text-center">
						<p className="text-sm text-muted-foreground">
							{t("connections:agent.noneConnected")}
						</p>
						<Button type="button" size="sm" onClick={() => openLane("chooser")}>
							<Plus size={13} className="mr-1.5" />
							{t("connections:add")}
						</Button>
					</div>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto p-2">
						{connections.map((connection) => {
							const rows = options.filter(
								(option) => option.connectionId === connection.id,
							);
							const blocked = unusableStatus(connection.id);
							// A one-provider connection IS its provider — a heading above a
							// single row repeating the same name reads like a bug. Only a
							// credential holding several apps needs to say where they came
							// from.
							const grouped = rows.length > 1 || Boolean(blocked);

							const providerRow = (option: ProviderOption) => {
								const on = isProviderSelected(draftConnections, option);
								return (
									<button
										key={option.key}
										type="button"
										onClick={() => toggle(option)}
										className={cn(
											"flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
											grouped && "ml-7 w-[calc(100%-1.75rem)]",
											on
												? "border-blue-500/30 bg-blue-500/10"
												: "border-transparent hover:bg-muted/60",
										)}
									>
										<span className="flex min-w-0 flex-1 items-center gap-2">
											{/* A grouped row is one app, so it wears the app's own
											    mark rather than repeating the credential's. */}
											{option.appId ? (
												<AppIcon
													name={option.label}
													src={option.logo}
													composioSlug={option.appId}
													size={20}
												/>
											) : (
												<KindIcon kind={connection.kind} />
											)}
											<span className="truncate text-xs font-medium">
												{option.label}
											</span>
											{grouped ? null : (
												<StatusDot status={statusOf(connection.id)} />
											)}
											{on ? (
												<Check
													size={11}
													strokeWidth={3}
													className="shrink-0 text-blue-500"
												/>
											) : null}
										</span>
										<Switch on={on} />
									</button>
								);
							};

							return (
								<div key={connection.id} className="mb-2 last:mb-0">
									{grouped ? (
										<div className="flex items-center gap-2 px-2 py-1.5">
											<KindIcon kind={connection.kind} />
											<span className="min-w-0 truncate text-xs font-semibold">
												{connection.name}
											</span>
											<StatusDot status={statusOf(connection.id)} />
											{/* An app the agent needs may simply not be authorized
											    yet; granting is useless without a way to add it. */}
											{connection.kind === "composio" ? (
												<button
													type="button"
													onClick={() => openLane("composio", true)}
													className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												>
													<Plus size={10} />
													{t("connections:agent.addApp")}
												</button>
											) : null}
										</div>
									) : null}

									{blocked ? (
										<p className="px-2 pb-2 pl-9 text-[11px] text-muted-foreground">
											{t(
												`connections:status.${
													blocked === "bridge-down"
														? "bridgeDown"
														: blocked === "incomplete"
															? "incomplete"
															: "error"
												}`,
											)}
										</p>
									) : rows.length === 0 ? (
										<button
											type="button"
											onClick={() =>
												openLane(
													connection.kind === "composio"
														? "composio"
														: "chooser",
													connection.kind === "composio",
												)
											}
											className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
										>
											<KindIcon kind={connection.kind} />
											<span className="font-medium">{connection.name}</span> —{" "}
											{t("connections:agent.noApps")}
										</button>
									) : (
										rows.map(providerRow)
									)}
								</div>
							);
						})}

						<button
							type="button"
							onClick={() => openLane("chooser")}
							className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-border/70 px-2 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
						>
							<span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-muted">
								<Plus size={11} />
							</span>
							{t("connections:add")}
						</button>
					</div>
				)}

				{problems.length > 0 ? (
					<div className="border-t border-amber-500/30 bg-amber-500/10 px-5 py-3">
						{problems.map((problem) => (
							<p
								key={problem.connectionId}
								className="flex items-start gap-2 text-[11px] leading-relaxed"
							>
								<AlertTriangle
									size={12}
									className="mt-0.5 shrink-0 text-amber-500"
								/>
								<span>
									<span className="font-medium">{problem.connectionName}</span>{" "}
									{t("connections:agent.scopeProblem")} {problem.message}
								</span>
							</p>
						))}
					</div>
				) : null}

				<div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						{totalTools > BUSY_TOOLBOX ? (
							<AlertTriangle
								size={12}
								className={
									totalTools > CROWDED_TOOLBOX
										? "text-destructive"
										: "text-amber-500"
								}
							/>
						) : null}
						{selectedCount === 0
							? t("connections:agent.noneSelected")
							: t("connections:agent.selectedCount", { count: selectedCount })}
						{totalTools > BUSY_TOOLBOX
							? ` — ${t("connections:agent.tooMany")}`
							: ""}
					</span>
					<Button
						type="button"
						size="sm"
						disabled={isSaving || checking}
						onClick={done}
					>
						{isSaving || checking ? (
							<Loader2 size={13} className="mr-1.5 animate-spin" />
						) : null}
						{t("connections:agent.done")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
});
