import { Loader2, Server, ShieldAlert, Square } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { MemonTerminalState } from "@/services/memon/types";
import type { MemonSend } from "../types";

const prompt = (cwd?: string) => `user@memon:${cwd ?? "/"}$`;

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
 * The Terminal. Output streams in while a command runs; the input line then
 * types into that command (Ctrl+C stops it). A command of the agent's that
 * needs approval waits here for the user to run or decline it.
 */
export const TerminalWindow: React.FC<{
	machineKey: string;
	terminal: MemonTerminalState;
	send: MemonSend;
}> = ({ machineKey, terminal, send }) => {
	const { t } = useTranslation("common");
	const [command, setCommand] = React.useState("");
	const outputRef = React.useRef<HTMLPreElement>(null);
	const running = terminal.runningCommand !== null;
	const servers = terminal.servers ?? [];
	const now = useNow(running);
	const { approval } = terminal;

	React.useEffect(() => {
		const output = outputRef.current;
		if (output) output.scrollTop = output.scrollHeight;
	}, [terminal.lines.length, running]);

	const stop = () => void send("terminal.stop", { key: machineKey });

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
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
			<pre
				ref={outputRef}
				className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed"
			>
				{terminal.lines.map((line, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: terminal lines have no ids
						key={index}
						data-memon-ask={
							line.kind === "command"
								? `$ ${line.text}`
								: line.text || undefined
						}
						className={cn(
							line.kind === "stderr" && "text-red-600 dark:text-red-400",
							line.kind === "system" && "text-muted-foreground",
							line.kind === "input" && "text-sky-700 dark:text-sky-300",
						)}
					>
						{line.kind === "command" ? (
							<>
								<span className="text-emerald-600 dark:text-emerald-400">
									{prompt(line.cwd)}
								</span>{" "}
								{line.text}
							</>
						) : line.kind === "input" ? (
							`> ${line.text}`
						) : (
							line.text || " "
						)}
					</div>
				))}
			</pre>
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
			) : null}
			<form
				className="flex shrink-0 items-center gap-2 rounded border border-border px-2 font-mono text-[11px]"
				onSubmit={(event) => {
					event.preventDefault();
					if (running) {
						// An empty line is an answer too (Enter at a prompt).
						setCommand("");
						void send("terminal.input", { key: machineKey, text: command });
						return;
					}
					const value = command.trim();
					if (!value) return;
					setCommand("");
					void send("terminal.exec", { key: machineKey, command: value });
				}}
			>
				<label
					htmlFor={`memon-terminal-${machineKey}`}
					className={cn(
						"whitespace-nowrap",
						running
							? "text-sky-700 dark:text-sky-300"
							: "text-emerald-600 dark:text-emerald-400",
					)}
				>
					{running ? ">" : prompt(terminal.cwd)}
				</label>
				<input
					id={`memon-terminal-${machineKey}`}
					data-memon-ref="t1"
					value={command}
					placeholder={
						running ? t("memonComputer.terminal.inputPlaceholder") : undefined
					}
					onChange={(event) => setCommand(event.target.value)}
					onKeyDown={(event) => {
						const input = event.currentTarget;
						const copying = input.selectionStart !== input.selectionEnd;
						if (
							running &&
							!copying &&
							event.ctrlKey &&
							event.key.toLowerCase() === "c"
						) {
							event.preventDefault();
							stop();
						}
					}}
					autoComplete="off"
					spellCheck={false}
					className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
				/>
			</form>
		</div>
	);
};
