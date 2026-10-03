import { History, Loader2, Server, ShieldAlert, Square } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { memonDisplayPath } from "@/services/memon/constants";
import { terminalRunsInFront } from "@/services/memon/terminal/terminal-state";
import type { MemonTerminalState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { TerminalTabs } from "./TerminalTabs";
import {
	XtermTerminal,
	type XtermTerminalHandle,
} from "./terminal/XtermTerminal";

/** Quiet this long, a running command may just be finished. */
const QUIET_MS = 5_000;

const formatElapsed = (ms: number): string => {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Ticks once a second while a command runs, for its elapsed time. */
const useNow = (active: boolean): number => {
	const [now, setNow] = React.useState(() => Date.now());
	React.useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [active]);
	return now;
};

/**
 * The Terminal: a real terminal screen (xterm.js) per tab. Output streams in
 * while a command runs; what is typed then goes into that command (Ctrl+C
 * stops it). A command of the agent's that needs approval waits here for the
 * user to run or decline it.
 */
export const TerminalWindow: React.FC<{
	machineKey: string;
	terminal: MemonTerminalState;
	/** The agent's home, shown as `~` in the prompt. */
	home: string;
	send: MemonSend;
}> = ({ machineKey, terminal, home, send }) => {
	const { t } = useTranslation("common");
	const screenRef = React.useRef<XtermTerminalHandle>(null);
	const history = terminal.history ?? [];
	// The running command belongs to one tab; the others run next to it.
	const running = terminalRunsInFront(terminal);
	const runningElsewhere = terminal.runningCommand !== null && !running;
	const servers = terminal.servers ?? [];
	const now = useNow(running);
	const { approval } = terminal;

	const stop = () => {
		void send("terminal.stop", { key: machineKey });
		screenRef.current?.focus();
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
			<div className="flex shrink-0 items-center gap-1">
				<div className="min-w-0 flex-1">
					<TerminalTabs
						tabs={terminal.tabs}
						activeTabId={terminal.activeTabId}
						home={home}
						onSelect={(terminalId) => {
							void send("terminal.select", { key: machineKey, terminalId });
							screenRef.current?.focus();
						}}
						onClose={(terminalId) =>
							void send("terminal.close", { key: machineKey, terminalId })
						}
						onNew={() => {
							void send("terminal.new", { key: machineKey });
							screenRef.current?.focus();
						}}
					/>
				</div>
				<button
					type="button"
					disabled={!history.length}
					aria-label={t("memonComputer.terminal.clearHistory")}
					title={`${t("memonComputer.terminal.clearHistory")} · ${t(
						"memonComputer.terminal.historyCount",
						{
							count: history.length,
							file: memonDisplayPath(terminal.historyPath ?? "", home),
						},
					)}`}
					onClick={() => {
						if (
							!window.confirm(t("memonComputer.terminal.clearHistoryConfirm"))
						)
							return;
						void send("terminal.clearHistory", { key: machineKey });
					}}
					className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
				>
					<History size={12} />
					{t("memonComputer.terminal.clear")}
				</button>
			</div>
			{approval ? (
				<div className="shrink-0 space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs">
					<div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
						<ShieldAlert size={13} />
						{approval.agentWaiting
							? t("memonComputer.terminal.approvalTitle")
							: t("memonComputer.terminal.approvalEarlier")}
					</div>
					<code className="block break-all rounded bg-background/70 px-2 py-1 font-mono text-[11px]">
						$ {approval.command}
					</code>
					<div className="flex flex-wrap items-center gap-2">
						<span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
							{approval.reason}
						</span>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 text-[11px]"
							onClick={() =>
								void send("terminal.approval", {
									key: machineKey,
									id: approval.id,
									decision: "deny",
								})
							}
						>
							{t("memonComputer.terminal.deny")}
						</Button>
						<Button
							type="button"
							size="sm"
							className="h-7 text-[11px]"
							onClick={() =>
								void send("terminal.approval", {
									key: machineKey,
									id: approval.id,
									decision: "approve",
								})
							}
						>
							{t("memonComputer.terminal.approve")}
						</Button>
					</div>
				</div>
			) : null}
			<XtermTerminal
				ref={screenRef}
				machineKey={machineKey}
				terminal={terminal}
				home={home}
				send={send}
			/>
			{running ? (
				<div className="flex shrink-0 items-center gap-2 px-1 text-[11px] text-muted-foreground">
					<Loader2 size={12} className="animate-spin" />
					<span className="min-w-0 flex-1 truncate font-mono">
						{t("memonComputer.terminal.running", {
							elapsed: formatElapsed(now - (terminal.startedAt ?? now)),
						})}
						{servers.length
							? ` · ${t("memonComputer.terminal.serving", {
									address: servers
										.map((port) => `localhost:${port}`)
										.join(", "),
								})}`
							: now - (terminal.lastOutputAt ?? now) >= QUIET_MS
								? ` · ${t("memonComputer.terminal.quiet", {
										elapsed: formatElapsed(
											now - (terminal.lastOutputAt ?? now),
										),
									})}`
								: ""}{" "}
						· {terminal.runningCommand}
					</span>
					{servers.map((port) => (
						<button
							key={port}
							type="button"
							onClick={() =>
								void send("browser.navigate", {
									key: machineKey,
									url: `http://localhost:${port}/`,
									newTab: true,
									embedded: true,
								})
							}
							className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 font-medium hover:bg-accent"
						>
							<Server size={10} />
							{t("memonComputer.terminal.openInBrowser", { port })}
						</button>
					))}
					<button
						type="button"
						onClick={stop}
						className="inline-flex h-6 items-center gap-1 rounded-md border border-input bg-background px-2 font-medium hover:bg-accent"
					>
						<Square size={10} />
						{t("memonComputer.terminal.stop")}
					</button>
				</div>
			) : runningElsewhere ? (
				<div className="flex shrink-0 items-center gap-2 px-1 text-[11px] text-muted-foreground">
					<Loader2 size={12} className="animate-spin" />
					<span className="min-w-0 flex-1 truncate">
						{t("memonComputer.terminal.otherTabRunning", {
							id: terminal.runningTabId,
						})}
					</span>
				</div>
			) : null}
		</div>
	);
};
