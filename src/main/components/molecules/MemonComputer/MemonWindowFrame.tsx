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
	onMove: (rect: Rect) => void;
	/** Sends this window's page, file or output to the chat composer. */
	onAsk?: () => void;
	children: React.ReactNode;
}

const FrameButton: React.FC<{
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}> = ({ label, onClick, children }) => (
	<button
		type="button"
		title={label}
		aria-label={label}
		onClick={onClick}
		className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
	>
		{children}
	</button>
);

/**
 * A computer window, in the runtime session card style. Dragging and resizing
 * are local until the pointer is released, then sent as one move.
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
		const origin: Rect = { x: window.x, y: window.y, w: window.w, h: window.h };
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
			setDraft(null);
			if (latest !== origin) onMove(latest);
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
				"absolute flex min-w-0 flex-col overflow-hidden rounded-md border bg-background shadow-sm",
				focused
					? userDriving
						? "border-amber-500/60"
						: "border-emerald-500/50"
					: "border-border",
			)}
		>
			<div
				className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-border bg-muted/20 py-1 pl-2 pr-1 active:cursor-grabbing"
				onPointerDown={(event) => startGesture(event, "move")}
			>
				<span className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
					<Icon size={11} />
					{window.id}
				</span>
				<span className="min-w-0 flex-1 truncate text-xs font-medium">
					{title}
				</span>
				{onAsk ? (
					<FrameButton label={t("memonComputer.ask.button")} onClick={onAsk}>
						<MessageSquarePlus size={13} />
					</FrameButton>
				) : null}
				<FrameButton label={t("memonComputer.minimize")} onClick={onMinimize}>
					<Minus size={13} />
				</FrameButton>
				<FrameButton label={t("memonComputer.maximize")} onClick={onMaximize}>
					<Maximize2 size={12} />
				</FrameButton>
				<FrameButton label={t("memonComputer.close")} onClick={onClose}>
					<X size={13} />
				</FrameButton>
			</div>
			<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			{!compact && !window.maximized ? (
				<div
					aria-hidden="true"
					className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize touch-none"
					onPointerDown={(event) => startGesture(event, "resize")}
				/>
			) : null}
		</div>
	);
};
