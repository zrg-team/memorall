import { Loader2, Play, Square } from "lucide-react";
import React from "react";
import { Button } from "@/main/components/ui/button";
import { useDesktopSandbox } from "@/main/hooks/use-desktop-sandbox";
import type { SandboxRuntimePort } from "@/platform/contracts/core";
import { desktopSandboxLabel } from "@/services/sandbox-container/desktop-sandbox-controller";

const plainBootLog = (log: string): string =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Serial console logs contain ANSI color escapes.
	log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

export const DesktopSandboxCard: React.FC<{
	runtime: SandboxRuntimePort;
	compact?: boolean;
}> = ({ runtime, compact = false }) => {
	const state = useDesktopSandbox(runtime);
	const { status, action, error, controller } = state;
	const [expanded, setExpanded] = React.useState(false);
	const starting = action === "starting" || status?.state === "starting";
	const stopping = action === "stopping" || status?.state === "stopping";
	const failure = error ?? status?.failure;
	const label = desktopSandboxLabel(state);
	const canStop = starting || status?.ready;
	return (
		<div
			className={
				compact
					? "shrink-0 rounded-md border border-border px-2 py-1 text-[11px] space-y-1"
					: "rounded-md border border-border p-3 space-y-2"
			}
			data-testid="desktop-sandbox-status"
		>
			<div className="flex items-center justify-between gap-2">
				<div className={compact ? "flex items-center gap-2" : "space-y-1"}>
					<div className="text-xs font-semibold">
						{compact ? "Sandbox" : "Desktop Sandbox"}
					</div>
					<div
						className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
						role="status"
						aria-label={`Sandbox: ${label}`}
					>
						<span
							aria-hidden="true"
							className={`h-1.5 w-1.5 rounded-full ${starting || stopping ? "bg-amber-500 animate-pulse" : status?.ready ? "bg-emerald-500" : failure ? "bg-destructive" : "bg-muted-foreground"}`}
						/>
						{label}
					</div>
				</div>
				<div className="flex items-center gap-1">
					{compact ? (
						<Button
							size="sm"
							variant="ghost"
							className="h-6 px-2 text-[11px]"
							aria-expanded={expanded}
							onClick={() => setExpanded(!expanded)}
						>
							Details
						</Button>
					) : null}
					<Button
						size="sm"
						variant="outline"
						className={compact ? "h-6 px-2 text-[11px]" : undefined}
						disabled={stopping || (!status && !failure && !starting)}
						onClick={() =>
							void (canStop ? controller?.stop() : controller?.start())
						}
					>
						{stopping ? (
							<Loader2 size={13} className="mr-1 animate-spin" />
						) : canStop ? (
							<Square size={13} className="mr-1" />
						) : (
							<Play size={13} className="mr-1" />
						)}
						{stopping
							? "Stopping…"
							: canStop
								? "Stop sandbox"
								: failure
									? "Retry"
									: "Start sandbox"}
					</Button>
				</div>
			</div>
			{!compact || expanded || starting ? (
				<p className="text-[11px] text-muted-foreground">
					{starting && status?.ready ? "Preparing your saved files. " : ""}
					Ubuntu is bundled with the app. Additional tools install when first
					used and remain available afterward. The first start can take a few
					minutes.
				</p>
			) : null}
			{!compact ? (
				<p className="text-xs text-muted-foreground">
					Terminal is available when the sandbox is ready. Stopping it ends
					running commands in all PCs. Saved files and installed tools remain
					for the next start.
				</p>
			) : null}
			{failure ? (
				<p
					className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] text-destructive"
					role="alert"
				>
					{failure}
				</p>
			) : null}
			{(!compact || expanded) && status?.bootLog ? (
				<details className="text-[11px] text-muted-foreground">
					<summary>Startup log</summary>
					<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">
						{plainBootLog(status.bootLog)}
					</pre>
				</details>
			) : null}
		</div>
	);
};
