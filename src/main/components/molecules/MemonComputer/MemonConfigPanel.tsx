import { Loader2, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { useDesktopSandbox } from "@/main/hooks/use-desktop-sandbox";
import type { SandboxRuntimePort } from "@/platform/contracts/core";
import { desktopSandboxLabel } from "@/services/sandbox-container/desktop-sandbox-controller";
import { DesktopSandboxCard } from "../RuntimeSessions/DesktopSandboxCard";

export interface MemonConfigSection {
	id: string;
	title: string;
	content: ReactNode;
}

/** Taskbar settings flyout; additional computer settings share this surface. */
export const MemonConfigPanel = ({
	runtime,
	open,
	onOpenChange,
	sections = [],
	compact = false,
}: {
	runtime: SandboxRuntimePort;
	open: boolean;
	onOpenChange(open: boolean): void;
	sections?: readonly MemonConfigSection[];
	compact?: boolean;
}) => {
	const state = useDesktopSandbox(runtime);
	const label = desktopSandboxLabel(state);
	const busy = label === "Starting…" || label === "Stopping…";
	return (
		<div
			className="flex shrink-0 items-center text-[11px]"
			data-testid="memon-settings-tray"
		>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label="Open computer settings"
						title={`Computer settings · Sandbox: ${label}`}
						className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Settings2 size={14} />
						<span className="flex flex-col items-start gap-0.5">
							{!compact ? (
								<span className="text-[11px] font-medium">Settings</span>
							) : null}
							<span
								role="status"
								aria-label={`Sandbox: ${label}`}
								className="flex items-center gap-1.5 text-[10px]"
							>
								{busy ? (
									<Loader2 size={10} className="animate-spin text-amber-500" />
								) : (
									<span
										aria-hidden
										className={`h-1.5 w-1.5 rounded-full ${state.ready ? "bg-emerald-500" : label === "Error" ? "bg-destructive" : "bg-muted-foreground"}`}
									/>
								)}
								<span className={compact ? "sr-only" : undefined}>
									Sandbox · {label}
								</span>
							</span>
						</span>
					</button>
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="end"
					sideOffset={12}
					collisionPadding={12}
					aria-label="Computer settings"
					className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-border/70 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl"
					data-testid="memon-config-panel"
				>
					<div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
						<Settings2 size={17} className="text-muted-foreground" />
						<h2 className="text-sm font-semibold">Computer settings</h2>
					</div>
					<div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
						<DesktopSandboxCard runtime={runtime} compact />
						{sections.map((section) => (
							<section
								key={section.id}
								aria-label={section.title}
								className="space-y-2 border-t border-border/60 pt-4"
							>
								<h3 className="text-xs font-semibold">{section.title}</h3>
								{section.content}
							</section>
						))}
					</div>
					<div className="border-t border-border/60 bg-muted/30 px-5 py-3 text-[11px] text-muted-foreground">
						Sandbox is shared by your agents and computers.
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
};
