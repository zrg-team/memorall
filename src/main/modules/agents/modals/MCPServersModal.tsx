import React from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Link2, Plus, Terminal } from "lucide-react";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { useConnectionsStore } from "@/main/stores/connections";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusDot, ToolScopeList } from "@/main/modules/connections";
import type { McpConnection } from "@/services/mcp-connections";

/** Past this, tool choice measurably degrades — worth saying out loud. */
const BUSY_TOOLBOX = 25;
const CROWDED_TOOLBOX = 50;

const KindIcon: React.FC<{ connection: McpConnection }> = ({ connection }) => {
	if (connection.kind === "composio") {
		return (
			<span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-500 text-[8px] font-bold text-white">
				C
			</span>
		);
	}
	return (
		<span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
			{connection.kind === "template" ? (
				<Terminal size={10} />
			) : (
				<Link2 size={10} />
			)}
		</span>
	);
};

export const MCPServersModal = NiceModal.create(() => {
	const modal = useModal();
	const { t } = useTranslation(["connections", "agents"]);

	const draftConnections = useAgentConfigStore(
		(state) => state.draftConnections,
	);
	const setAgentConnections = useAgentConfigStore(
		(state) => state.setAgentConnections,
	);

	const connections = useConnectionsStore((state) => state.connections);
	const initialize = useConnectionsStore((state) => state.initialize);
	const statusOf = useConnectionsStore((state) => state.statusOf);
	const toolsOf = useConnectionsStore((state) => state.toolsOf);

	const [focusedId, setFocusedId] = React.useState<string | null>(null);

	React.useEffect(() => {
		void initialize();
	}, [initialize]);

	React.useEffect(() => {
		if (!focusedId && connections.length > 0) {
			setFocusedId(draftConnections[0]?.connectionId ?? connections[0].id);
		}
	}, [connections, draftConnections, focusedId]);

	const selectionFor = (id: string) =>
		draftConnections.find((entry) => entry.connectionId === id);

	const toggle = (connection: McpConnection) => {
		const existing = selectionFor(connection.id);
		setAgentConnections(
			existing
				? draftConnections.filter(
						(entry) => entry.connectionId !== connection.id,
					)
				: [...draftConnections, { connectionId: connection.id }],
		);
		setFocusedId(connection.id);
	};

	const setScope = (connectionId: string, toolAllowlist: string[]) => {
		setAgentConnections(
			draftConnections.map((entry) =>
				entry.connectionId === connectionId
					? {
							...entry,
							toolAllowlist:
								toolAllowlist.length > 0 ? toolAllowlist : undefined,
						}
					: entry,
			),
		);
	};

	const totalTools = draftConnections.reduce((total, selection) => {
		const descriptors = toolsOf(selection.connectionId);
		return (
			total +
			(selection.toolAllowlist?.length
				? selection.toolAllowlist.length
				: descriptors.length)
		);
	}, 0);

	const focused = connections.find((connection) => connection.id === focusedId);
	const focusedSelection = focusedId ? selectionFor(focusedId) : undefined;

	return (
		<Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
			<DialogContent className="flex max-h-[min(90dvh,720px)] w-[calc(100vw-1rem)] max-w-[760px] flex-col gap-0 overflow-hidden rounded-2xl border-border/60 p-0 shadow-2xl sm:w-[min(94vw,760px)]">
				<DialogHeader className="border-b px-5 pb-3 pt-4">
					<DialogTitle className="text-base">
						{t("connections:agent.label")}
					</DialogTitle>
					<p className="text-xs text-muted-foreground">
						{t("connections:agent.modalSubtitle")}
					</p>
				</DialogHeader>

				{connections.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-12 text-center">
						<p className="text-sm text-muted-foreground">
							{t("connections:agent.noneConnected")}
						</p>
						<Button
							type="button"
							size="sm"
							onClick={() => {
								modal.hide();
								window.location.hash = "#/connections";
							}}
						>
							<Plus size={13} className="mr-1.5" />
							{t("connections:agent.goToConnections")}
						</Button>
					</div>
				) : (
					<div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[240px_1fr]">
						<div className="min-h-0 overflow-y-auto border-b p-2 sm:border-b-0 sm:border-r">
							{connections.map((connection) => {
								const status = statusOf(connection.id);
								const isOn = Boolean(selectionFor(connection.id));
								// "incomplete" means setup never produced an endpoint, so
								// enabling it would add a connection that resolves to nothing.
								const unusable =
									status === "bridge-down" ||
									status === "error" ||
									status === "incomplete";
								return (
									<button
										key={connection.id}
										type="button"
										onClick={() => !unusable && toggle(connection)}
										disabled={unusable}
										className={cn(
											"flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
											connection.id === focusedId
												? "border-blue-500/30 bg-blue-500/10"
												: "border-transparent hover:bg-muted/60",
											unusable && "cursor-not-allowed opacity-60",
										)}
									>
										<KindIcon connection={connection} />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-xs font-medium">
												{connection.name}
											</span>
											<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
												<StatusDot status={status} />
												{unusable
													? t(
															`connections:status.${
																status === "bridge-down"
																	? "bridgeDown"
																	: status === "incomplete"
																		? "incomplete"
																		: "error"
															}`,
														)
													: t("connections:detail.toolCount", {
															count: toolsOf(connection.id).length,
														})}
											</span>
										</span>
										<span
											className={cn(
												"relative h-4 w-7 shrink-0 rounded-full transition-colors",
												isOn ? "bg-blue-500" : "bg-muted",
											)}
										>
											<span
												className={cn(
													"absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all",
													isOn ? "left-3.5" : "left-0.5",
												)}
											/>
										</span>
									</button>
								);
							})}
						</div>

						<div className="min-h-0 overflow-y-auto p-4">
							{focused ? (
								focusedSelection ? (
									<div className="space-y-3">
										<div className="flex items-center gap-2">
											<KindIcon connection={focused} />
											<span className="text-sm font-semibold">
												{focused.name}
											</span>
										</div>
										<ToolScopeList
											tools={toolsOf(focused.id)}
											value={focusedSelection.toolAllowlist ?? []}
											onChange={(next) => setScope(focused.id, next)}
										/>
									</div>
								) : (
									<p className="py-10 text-center text-xs text-muted-foreground">
										{t("connections:status.enable")} “{focused.name}”
									</p>
								)
							) : null}
						</div>
					</div>
				)}

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
						{t("connections:agent.totalTools", { count: totalTools })}
						{totalTools > BUSY_TOOLBOX
							? ` — ${t("connections:agent.tooMany")}`
							: ""}
					</span>
					<Button type="button" size="sm" onClick={() => modal.hide()}>
						{t("connections:agent.done")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
});
