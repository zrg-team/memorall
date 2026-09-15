import { PanelLeftClose, X } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { CollapsedRailItem } from "../ChatSidePanel/CollapsedRailItem";

export interface WorkspaceSidePanelLabels {
	/** Accessible name of the whole panel. */
	region: string;
	title: string;
	/** Under the title, e.g. "12 conversations". */
	count: string;
	expand: string;
	collapse: string;
	close: string;
	resize: string;
	/** The collapsed rail's "new" item. */
	create: string;
}

interface WorkspaceSidePanelProps {
	/**
	 * Names the persisted collapsed/width state (`memorall.<key>.collapsed`),
	 * so each workspace remembers its own panel.
	 */
	storageKey: string;
	labels: WorkspaceSidePanelLabels;
	itemCount: number;
	/** The collapsed rail's icons: the list, and creating a new item. */
	railIcon: React.ReactNode;
	createIcon: React.ReactNode;
	onCreate: () => void;
	defaultCollapsed?: boolean;
	allowCollapse?: boolean;
	allowResize?: boolean;
	onClose?: () => void;
	children: React.ReactNode;
	className?: string;
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;

const readStored = (key: string): string | null => {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

const writeStored = (key: string, value: string) => {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable (private mode); the panel still works.
	}
};

/**
 * The history panel beside a workspace: a titled, resizable list that
 * collapses to an icon rail. Chat and every studio use it, so the left side of
 * the main panel looks and behaves the same whatever the workspace is.
 */
export const WorkspaceSidePanel: React.FC<WorkspaceSidePanelProps> = ({
	storageKey,
	labels,
	itemCount,
	railIcon,
	createIcon,
	onCreate,
	defaultCollapsed = false,
	allowCollapse = true,
	allowResize = true,
	onClose,
	children,
	className,
}) => {
	const collapsedKey = `memorall.${storageKey}.collapsed`;
	const widthKey = `memorall.${storageKey}.width`;
	const [collapsed, setCollapsed] = useState(() => {
		if (!allowCollapse) return false;
		const stored = readStored(collapsedKey);
		return stored === null ? defaultCollapsed : stored === "true";
	});
	const [width, setWidth] = useState(() => {
		const stored = Number(readStored(widthKey));
		return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
			? stored
			: DEFAULT_WIDTH;
	});
	const isDraggingRef = useRef(false);
	const dragStartXRef = useRef(0);
	const dragStartWidthRef = useRef(0);

	const updateCollapsed = (nextCollapsed: boolean) => {
		setCollapsed(nextCollapsed);
		writeStored(collapsedKey, String(nextCollapsed));
	};

	const updateWidth = (nextWidth: number) => {
		const constrained = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, nextWidth));
		setWidth(constrained);
		writeStored(widthKey, String(constrained));
	};

	const handleResizeMouseDown = (event: React.MouseEvent) => {
		event.preventDefault();
		isDraggingRef.current = true;
		dragStartXRef.current = event.clientX;
		dragStartWidthRef.current = width;

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!isDraggingRef.current) return;
			updateWidth(
				dragStartWidthRef.current + moveEvent.clientX - dragStartXRef.current,
			);
		};

		const onMouseUp = () => {
			isDraggingRef.current = false;
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	const isCollapsed = allowCollapse && collapsed;

	return (
		<aside
			className={cn(
				"relative z-10 h-full min-h-0 flex-shrink-0 transition-[width] duration-200 ease-out",
				className,
			)}
			style={
				isCollapsed
					? { width: 56 }
					: allowResize
						? { width, maxWidth: "100%" }
						: { width: "100%" }
			}
			aria-label={labels.region}
			data-workspace-side-panel={storageKey}
			data-collapsed={isCollapsed ? "true" : undefined}
		>
			<div
				className={cn(
					"flex h-full min-h-0 flex-col border-r border-border/70",
					isCollapsed ? "bg-background" : "bg-card/80 backdrop-blur-xl",
				)}
			>
				{/* Collapsed, the rail's first item expands the panel and the workspace
				    header sits above it: a header row here would only repeat both. */}
				{isCollapsed ? null : (
					<header className="flex h-[58px] flex-shrink-0 items-center gap-2 border-b border-border/70 px-3">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold text-foreground">
								{labels.title}
							</div>
							<div className="text-[11px] text-muted-foreground">
								{labels.count}
							</div>
						</div>
						{allowCollapse ? (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => updateCollapsed(true)}
								className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label={labels.collapse}
							>
								<PanelLeftClose size={17} />
							</Button>
						) : onClose ? (
							<Button
								type="button"
								data-chat-side-panel-close
								variant="ghost"
								size="icon"
								onClick={onClose}
								className="h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label={labels.close}
							>
								<X size={17} />
							</Button>
						) : null}
					</header>
				)}

				{isCollapsed ? (
					<div className="flex w-14 flex-1 flex-col items-center gap-1 px-0 py-2">
						<CollapsedRailItem
							icon={railIcon}
							label={labels.expand}
							count={itemCount}
							active
							onClick={() => updateCollapsed(false)}
						/>
						<CollapsedRailItem
							icon={createIcon}
							label={labels.create}
							newChat
							onClick={onCreate}
						/>
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col p-2">{children}</div>
				)}
			</div>

			{allowResize && !isCollapsed ? (
				<hr
					aria-label={labels.resize}
					aria-orientation="vertical"
					aria-valuemin={MIN_WIDTH}
					aria-valuemax={MAX_WIDTH}
					aria-valuenow={width}
					tabIndex={0}
					onMouseDown={handleResizeMouseDown}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") updateWidth(width - 16);
						if (event.key === "ArrowRight") updateWidth(width + 16);
					}}
					className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize border-0 bg-transparent transition-colors hover:bg-primary/40 focus:bg-primary/40 focus:outline-none"
				/>
			) : null}
		</aside>
	);
};
