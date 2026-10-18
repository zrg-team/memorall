import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import type { MemonWindowApp } from "@/services/memon/constants";
import type { MemonWindowState } from "@/services/memon/types";
import {
	type MemonDockGroupId,
	type MemonDockLauncher,
	memonDockLayout,
} from "./dock-layout";
import { MEMON_APP_ICONS, MEMON_APP_TINTS } from "./MemonWindowFrame";

/** An app's window as the dock marks it. */
interface DockMark {
	open?: MemonWindowState;
	active: boolean;
	/** The app is working on its own (pi code mid-turn). */
	busy?: boolean;
	/** The app waits for the user's answer (an agent request in pi code). */
	attention?: boolean;
}

const dockItemClass = (compact: boolean, active: boolean, open: boolean) =>
	cn(
		"group relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
		compact ? "h-10 w-10" : "h-12 min-w-[60px]",
		active
			? "bg-blue-500/10 text-foreground"
			: open
				? "text-foreground hover:bg-muted"
				: "text-muted-foreground hover:bg-muted hover:text-foreground",
	);

const ICON_BOX =
	"flex h-6 w-6 items-center justify-center rounded-md transition-transform duration-150 group-hover:-translate-y-px group-disabled:translate-y-0 motion-reduce:transition-none";

/** The line under an open app: blue when in front, amber when it asks, green when working. */
const OpenMark: React.FC<Omit<DockMark, "open">> = ({
	active,
	busy,
	attention,
}) => (
	<span
		className={cn(
			"absolute bottom-px h-[3px] rounded-full",
			active ? "w-4" : "w-1",
			attention
				? "w-4 bg-amber-500 motion-safe:animate-pulse"
				: busy
					? "bg-emerald-500 motion-safe:animate-pulse"
					: active
						? "bg-blue-500"
						: "bg-muted-foreground/60",
		)}
	/>
);

const DockButton: React.FC<
	DockMark & {
		app: MemonWindowApp;
		label: string;
		compact: boolean;
		disabled?: boolean;
		reason?: string;
		onClick: () => void;
	}
> = ({
	app,
	label,
	open,
	active,
	compact,
	disabled,
	reason,
	busy,
	attention,
	onClick,
}) => {
	const Icon = MEMON_APP_ICONS[app];
	const name = open ? `${label} · ${open.id}` : label;
	return (
		<button
			type="button"
			disabled={disabled}
			title={disabled ? reason : name}
			aria-label={name}
			aria-current={active ? "true" : undefined}
			onClick={onClick}
			className={dockItemClass(compact, active, Boolean(open))}
		>
			<span className={cn(ICON_BOX, MEMON_APP_TINTS[app])}>
				<Icon size={14} />
			</span>
			{!compact ? (
				<span className="max-w-[72px] truncate leading-tight">{label}</span>
			) : null}
			{open ? (
				<OpenMark active={active} busy={busy} attention={attention} />
			) : null}
		</button>
	);
};

/**
 * A group in the dock: its first apps' icons, opening all of its apps. It
 * marks no window of its own: an open app is in the dock beside it.
 */
const DockGroup: React.FC<{
	id: MemonDockGroupId;
	launchers: MemonDockLauncher[];
	compact: boolean;
	markOf: (app: MemonWindowApp) => DockMark;
	onOpen: (app: MemonWindowApp) => void;
}> = ({ id, launchers, compact, markOf, onOpen }) => {
	const { t } = useTranslation();
	const [shown, setShown] = React.useState(false);
	const label = t(`memonComputer.dock.groups.${id}`);
	return (
		<Popover open={shown} onOpenChange={setShown}>
			<PopoverTrigger asChild>
				<button
					type="button"
					title={label}
					aria-label={label}
					aria-expanded={shown}
					className={dockItemClass(compact, shown, false)}
				>
					<span className="grid h-6 w-6 grid-cols-2 gap-px rounded-md bg-muted p-[3px] transition-transform duration-150 group-hover:-translate-y-px motion-reduce:transition-none">
						{launchers.slice(0, 4).map((launcher) => {
							const Icon = MEMON_APP_ICONS[launcher.id];
							return (
								<span
									key={launcher.id}
									className={cn(
										"flex items-center justify-center rounded-[2px]",
										MEMON_APP_TINTS[launcher.id],
									)}
								>
									<Icon size={7} />
								</span>
							);
						})}
					</span>
					{!compact ? (
						<span className="max-w-[72px] truncate leading-tight">{label}</span>
					) : null}
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				sideOffset={8}
				className="w-auto max-w-[min(360px,90vw)] p-2"
				aria-label={label}
			>
				<p className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
					{label}
				</p>
				<div className="grid grid-cols-3 gap-1">
					{launchers.map((launcher) => (
						<DockButton
							key={launcher.id}
							app={launcher.id}
							label={t(`memonComputer.apps.${launcher.id}`)}
							compact={false}
							disabled={!launcher.available}
							reason={launcher.reason}
							{...markOf(launcher.id)}
							onClick={() => {
								setShown(false);
								onOpen(launcher.id);
							}}
						/>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
};

/**
 * The computer's dock: its pinned apps, a button per group of the others,
 * and, after a divider, grouped apps (and the Editor) with a window open.
 */
export const MemonDock: React.FC<{
	label: string;
	launchers: MemonDockLauncher[];
	windows: MemonWindowState[];
	focusedWindowId: string | null;
	compact: boolean;
	/** pi code is mid-turn. */
	piWorking?: boolean;
	/** pi code waits for the user's answer. */
	piAttention?: boolean;
	/** fx is mid-turn. */
	fxWorking?: boolean;
	/** Settings and status stay at the right end of the same taskbar. */
	tray?: React.ReactNode;
	onOpen: (app: MemonWindowApp) => void;
}> = ({
	label,
	launchers,
	windows,
	focusedWindowId,
	compact,
	piWorking,
	piAttention,
	fxWorking,
	tray,
	onOpen,
}) => {
	const { t } = useTranslation();
	const markOf = (app: MemonWindowApp): DockMark => {
		const open = windows.find((window) => window.app === app);
		return {
			open,
			active: Boolean(open && open.id === focusedWindowId && !open.minimized),
			busy: (app === "pi" && piWorking) || (app === "fx" && fxWorking),
			attention: app === "pi" && piAttention,
		};
	};
	const { entries, running } = memonDockLayout(launchers, (app) =>
		windows.some((window) => window.app === app),
	);
	const editorOpen = windows.some((window) => window.app === "editor");
	const button = (launcher: MemonDockLauncher) => (
		<DockButton
			key={launcher.id}
			app={launcher.id}
			label={t(`memonComputer.apps.${launcher.id}`)}
			compact={compact}
			disabled={!launcher.available}
			reason={launcher.reason}
			{...markOf(launcher.id)}
			onClick={() => onOpen(launcher.id)}
		/>
	);
	return (
		<nav
			aria-label={label}
			data-testid="memon-taskbar"
			className={cn(
				"flex shrink-0 items-center border-t bg-background px-2",
				compact ? "h-12" : "h-14",
			)}
		>
			<div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
				<div className="mx-auto flex items-center gap-1">
					{entries.map((entry) =>
						entry.kind === "app" ? (
							button(entry.launcher)
						) : (
							<DockGroup
								key={entry.id}
								id={entry.id}
								launchers={entry.launchers}
								compact={compact}
								markOf={markOf}
								onOpen={onOpen}
							/>
						),
					)}
					{running.length || editorOpen ? (
						<span aria-hidden className="mx-1 h-7 w-px shrink-0 bg-border" />
					) : null}
					{running.map(button)}
					{editorOpen ? button({ id: "editor", available: true }) : null}
				</div>
			</div>
			{tray ? (
				<div className="ml-2 flex shrink-0 items-center border-l border-border/60 pl-2">
					{tray}
				</div>
			) : null}
		</nav>
	);
};
