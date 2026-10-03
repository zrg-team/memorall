import {
	CalendarClock,
	Eye,
	FileText,
	FolderOpen,
	Globe,
	ListChecks,
	Maximize2,
	MessageSquarePlus,
	Minus,
	Plug,
	Sparkles,
	SquareTerminal,
	WandSparkles,
	LayoutDashboard,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import type { MemonWindowApp } from "@/services/memon/constants";
import type { MemonWindowState } from "@/services/memon/types";

export const MEMON_APP_ICONS: Record<
	MemonWindowApp,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	browser: Globe,
	files: FolderOpen,
	editor: FileText,
	viewer: Eye,
	terminal: SquareTerminal,
	notes: ListChecks,
	scheduler: CalendarClock,
	studio: Sparkles,
	skills: WandSparkles,
	connections: Plug,
	visualize: LayoutDashboard,
};

/** Each app's tile color, shared by window title bars, the dock and the launcher. */
export const MEMON_APP_TINTS: Record<MemonWindowApp, string> = {
	browser: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
	files: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
	editor: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
	viewer: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
	terminal: "bg-zinc-500/20 text-zinc-800 dark:text-zinc-200",
	notes: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
	scheduler: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
	studio: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
	skills: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
	connections: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	visualize: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
};

const LOGO_URL = platform.assets.url("logo.png");

/** The app icon, used as the computer's own mark. */
export const MemonLogo: React.FC<{ size?: number; className?: string }> = ({
	size = 28,
	className,
}) => (
	<img
		src={LOGO_URL}
		alt=""
		aria-hidden="true"
		width={size}
		height={size}
		draggable={false}
		className={cn("shrink-0 select-none object-contain", className)}
	/>
);

type Rect = Pick<MemonWindowState, "x" | "y" | "w" | "h">;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

interface MemonWindowFrameProps {
	window: MemonWindowState;
	title: string;
	focused: boolean;
	userDriving: boolean;
	/** Narrow desktops show only the focused window, full size. */
	compact: boolean;
	desktopRef: React.RefObject<HTMLDivElement | null>;
	onFocus: () => void;
	onMinimize: () => void;
	onMaximize: () => void;
	onClose: () => void;
	/** Resolves once the machine has the new rect. */
	onMove: (rect: Rect) => void | Promise<void>;
	/** Sends this window's page, file or output to the chat composer. */
	onAsk?: () => void;
	children: React.ReactNode;
}

const FrameButton: React.FC<{
	label: string;
	onClick: () => void;
	danger?: boolean;
	children: React.ReactNode;
}> = ({ label, onClick, danger, children }) => (
	<button
		type="button"
		title={label}
		aria-label={label}
		onClick={onClick}
		className={cn(
			"inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			danger
				? "hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400"
				: "hover:bg-muted hover:text-foreground",
		)}
	>
		{children}
	</button>
);

/**
 * A computer window. The focused one wears its driver's color: blue while
 * the bot drives, orange while the user does. Dragging and resizing are local
 * until the pointer is released, then sent as one move.
 */
export const MemonWindowFrame: React.FC<MemonWindowFrameProps> = ({
	window,
	title,
	focused,
	userDriving,
	compact,
	desktopRef,
	onFocus,
	onMinimize,
	onMaximize,
	onClose,
	onMove,
	onAsk,
	children,
}) => {
	const { t } = useTranslation("common");
	const [draft, setDraft] = React.useState<Rect | null>(null);
	const Icon = MEMON_APP_ICONS[window.app];
	const rect = draft ?? window;

	const startGesture = (
		event: React.PointerEvent<HTMLElement>,
		mode: "move" | "resize",
	) => {
		if (compact || window.maximized || event.button !== 0) return;
		if ((event.target as HTMLElement).closest("button")) return;
		const desktop = desktopRef.current?.getBoundingClientRect();
		if (!desktop) return;
		event.preventDefault();
		onFocus();
		const target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		// Start from what is on screen: a dropped rect may still be saving.
		const origin: Rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
		let latest = origin;
		const move = (moveEvent: PointerEvent) => {
			const dx = (moveEvent.clientX - start.x) / desktop.width;
			const dy = (moveEvent.clientY - start.y) / desktop.height;
			latest =
				mode === "move"
					? {
							...origin,
							x: clamp(origin.x + dx, -origin.w + 0.12, 0.94),
							y: clamp(origin.y + dy, 0, 0.92),
						}
					: {
							...origin,
							w: clamp(origin.w + dx, 0.2, 1 - origin.x),
							h: clamp(origin.h + dy, 0.18, 1 - origin.y),
						};
			setDraft(latest);
		};
		const end = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", end);
			target.removeEventListener("pointercancel", end);
			if (latest === origin) return;
			const dropped = latest;
			// Hold the dropped rect until the machine's snapshot carries it, or the
			// window flashes back to its old place for a frame. A newer drag keeps
			// its own draft.
			void Promise.resolve(onMove(dropped)).finally(() =>
				setDraft((current) => (current === dropped ? null : current)),
			);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", end);
		target.addEventListener("pointercancel", end);
	};

	const style: React.CSSProperties =
		compact || window.maximized
			? { inset: compact ? 6 : 0, zIndex: window.z }
			: {
					left: `${rect.x * 100}%`,
					top: `${rect.y * 100}%`,
					width: `${rect.w * 100}%`,
					height: `${rect.h * 100}%`,
					zIndex: window.z,
				};

	return (
		<div
			data-memon-window={window.id}
			role="group"
			aria-label={title}
			style={style}
			onPointerDown={onFocus}
			className={cn(
				"absolute flex min-w-0 flex-col overflow-hidden border bg-background transition-[box-shadow,border-color] duration-200",
				window.maximized && !compact ? "rounded-none" : "rounded-lg",
				// One border line; the driver's color shows in it and in the glow.
				focused
					? userDriving
						? "border-orange-400 shadow-[0_10px_32px_-8px_rgb(251_146_60/0.45)]"
						: "border-blue-500 shadow-[0_10px_32px_-8px_rgb(59_130_246/0.45)]"
					: "border-border shadow-[0_8px_24px_-10px_rgb(0_0_0/0.35)]",
			)}
		>
			<div
				className={cn(
					"flex h-9 shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-border pl-2 pr-1 active:cursor-grabbing",
					focused ? "bg-muted/50" : "bg-muted/25",
				)}
				onPointerDown={(event) => startGesture(event, "move")}
			>
				<span
					className={cn(
						"inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
						MEMON_APP_TINTS[window.app],
					)}
				>
					<Icon size={13} />
				</span>
				<span
					className={cn(
						"min-w-0 truncate text-[13px] font-medium",
						focused ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{title}
				</span>
				<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
					{window.id}
				</span>
				<span className="min-w-0 flex-1" />
				{onAsk ? (
					<FrameButton label={t("memonComputer.ask.button")} onClick={onAsk}>
						<MessageSquarePlus size={14} />
					</FrameButton>
				) : null}
				<FrameButton label={t("memonComputer.minimize")} onClick={onMinimize}>
					<Minus size={14} />
				</FrameButton>
				<FrameButton label={t("memonComputer.maximize")} onClick={onMaximize}>
					<Maximize2 size={13} />
				</FrameButton>
				<FrameButton label={t("memonComputer.close")} onClick={onClose} danger>
					<X size={14} />
				</FrameButton>
			</div>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			{!compact && !window.maximized ? (
				<div
					aria-hidden="true"
					className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize touch-none items-end justify-end p-[3px] text-muted-foreground/60"
					onPointerDown={(event) => startGesture(event, "resize")}
				>
					<svg
						width="8"
						height="8"
						viewBox="0 0 8 8"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M7 1 1 7M7 4 4 7"
							stroke="currentColor"
							strokeWidth="1.2"
							strokeLinecap="round"
						/>
					</svg>
				</div>
			) : null}
		</div>
	);
};
