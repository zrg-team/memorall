import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { useConnectionsStore } from "@/main/stores/connections";
import {
	formatCommandLine,
	type McpConnection,
} from "@/services/mcp-connections";
import { LocalServerLog } from "./LocalServerLog";
import { StatusPill } from "./StatusPill";

const POLL_MS = 2_000;

/** Process controls and the live log for one local server. */
export const LocalServerRuntimePanel: React.FC<{
	connection: McpConnection;
}> = ({ connection }) => {
	const { t } = useTranslation("connections");
	const status = useConnectionsStore((state) => state.statusOf(connection.id));
	const runtime = useConnectionsStore(
		(state) => state.localServers[connection.id],
	);
	const discovering = useConnectionsStore((state) =>
		state.discovering.includes(connection.id),
	);
	const refreshLocalServers = useConnectionsStore(
		(state) => state.refreshLocalServers,
	);
	const discover = useConnectionsStore((state) => state.discover);
	const stopLocalServer = useConnectionsStore((state) => state.stopLocalServer);
	const restartLocalServer = useConnectionsStore(
		(state) => state.restartLocalServer,
	);
	const [busy, setBusy] = React.useState(false);

	// A process changes state on its own (it crashes, an agent run starts it), so
	// this view keeps asking while it is open.
	React.useEffect(() => {
		void refreshLocalServers();
		const timer = window.setInterval(() => void refreshLocalServers(), POLL_MS);
		return () => window.clearInterval(timer);
	}, [refreshLocalServers]);

	const act = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	};

	const state = runtime?.status?.state;
	const isRunning = state === "running";
	const working = busy || discovering || state === "starting";

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
					<StatusPill status={status} />
					{runtime?.status?.pid ? (
						<span className="font-mono">
							{t("template.pid", { pid: runtime.status.pid })}
						</span>
					) : null}
					{isRunning && runtime?.status?.startedAt ? (
						<span>
							{t("template.startedAt", {
								when: new Date(runtime.status.startedAt).toLocaleTimeString(),
							})}
						</span>
					) : null}
				</div>
				<div className="flex items-center gap-1.5">
					{isRunning ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-lg px-2 text-[11px]"
								disabled={working}
								onClick={() =>
									void act(() => restartLocalServer(connection.id))
								}
							>
								<RotateCw size={11} className="mr-1" />
								{t("template.restart")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 rounded-lg px-2 text-[11px]"
								disabled={working}
								onClick={() => void act(() => stopLocalServer(connection.id))}
							>
								<Square size={10} className="mr-1" />
								{t("template.stop")}
							</Button>
						</>
					) : (
						<Button
							type="button"
							size="sm"
							className="h-7 rounded-lg px-2.5 text-[11px]"
							disabled={working || status === "needs-approval"}
							onClick={() =>
								void act(() =>
									state === "error" || state === "exited"
										? restartLocalServer(connection.id)
										: discover(connection.id),
								)
							}
						>
							{working ? (
								<Loader2 size={11} className="mr-1 animate-spin" />
							) : (
								<Play size={11} className="mr-1" />
							)}
							{t("template.start")}
						</Button>
					)}
				</div>
			</div>

			{connection.stdio ? (
				<pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[10.5px]">
					{formatCommandLine(connection.stdio)}
				</pre>
			) : null}

			{status === "stopped" ? (
				<p className="text-[11px] text-muted-foreground">
					{t("template.stoppedHint")}
				</p>
			) : null}

			<LocalServerLog lines={runtime?.status?.logTail ?? []} />
		</div>
	);
};
