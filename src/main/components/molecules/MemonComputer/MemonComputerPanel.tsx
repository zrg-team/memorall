import {
	AppWindow,
	Camera,
	Crop,
	FileText,
	Hand,
	Loader2,
	MessageSquarePlus,
	Monitor,
	Pause,
	Play,
	Power,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/main/components/ui/tabs";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { logError } from "@/utils/logger";
import { type CaptureCrop, captureComputerScreen } from "./capture-screen";
import { MemonCaptureOverlay } from "./MemonCaptureOverlay";
import { cn } from "@/lib/utils";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import {
	MEMON_BUILTIN_APPS,
	type MemonWindowApp,
	memonDisplayPath,
} from "@/services/memon/constants";
import { serializeScreen } from "@/services/memon/screen-serializer";
import type {
	MemonMachineSnapshot,
	MemonStatus,
	MemonWindowState,
} from "@/services/memon/types";
import { askInChat, memonWindowTarget } from "./ask-in-chat";
import { MemonAgentCursor, MemonUserCursor } from "./MemonAgentCursor";
import { MemonDesktopIcons } from "./MemonDesktopIcons";
import {
	MEMON_APP_ICONS,
	MEMON_APP_TINTS,
	MemonLogo,
	MemonWindowFrame,
} from "./MemonWindowFrame";
import { BrowserWindow } from "./windows/BrowserWindow";
import { EditorWindow } from "./windows/EditorWindow";
import { FilesWindow } from "./windows/FilesWindow";
import { TerminalWindow } from "./windows/TerminalWindow";
import { MemonWindowErrorBoundary } from "./MemonWindowErrorBoundary";
import { ViewerWindow } from "./windows/ViewerWindow";
import { KitWindow } from "./windows/KitWindow";
import { VisualizeWindow } from "./windows/VisualizeWindow";
import { useMemonAskMenu } from "./use-memon-ask-menu";
import { useMemonExportDownloads } from "./use-export-downloads";

const COMPACT_WIDTH = 600;

/** Blue while the bot drives, orange while the user does, neutral otherwise. */
type StatusTone = "memon" | "you" | "idle";

const statusTone = (status: MemonStatus, userDriving: boolean): StatusTone =>
	userDriving || status === "waiting-for-user"
		? "you"
		: status === "working"
			? "memon"
			: "idle";

const STATUS_TONES: Record<
	StatusTone,
	{ pill: string; dot: string; ping: boolean }
> = {
	memon: {
		pill: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
		dot: "bg-blue-500",
		ping: true,
	},
	you: {
		pill: "border-orange-400 bg-orange-400 text-orange-950",
		dot: "bg-orange-950",
		ping: false,
	},
	idle: {
		pill: "border-border bg-muted/60 text-muted-foreground",
		dot: "bg-muted-foreground/70",
		ping: false,
	},
};

const StatusPill: React.FC<{ tone: StatusTone; label: string }> = ({
	tone,
	label,
}) => {
	const style = STATUS_TONES[tone];
	return (
		<span
			role="status"
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-2 rounded-full border pl-2.5 pr-3 text-[13px] font-semibold",
				style.pill,
			)}
		>
			<span className="relative flex h-2.5 w-2.5">
				{style.ping ? (
					<span
						className={cn(
							"absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none",
							style.dot,
						)}
					/>
				) : null}
				<span className={cn("relative h-2.5 w-2.5 rounded-full", style.dot)} />
			</span>
			{label}
		</span>
	);
};

/** Header buttons: one colored primary action per state, the rest quiet. */
const QUIET_BUTTON = "h-8 rounded-md text-[13px]";
const SEGMENT =
	"h-7 rounded-[4px] px-3 py-0 text-[13px] data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/[0.12]";
const YOU_BUTTON =
	"h-8 rounded-md border-transparent bg-orange-400 text-[13px] font-semibold text-orange-950 hover:bg-orange-300 hover:text-orange-950";
const MEMON_BUTTON =
	"h-8 rounded-md border-transparent bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-500 hover:text-white";

const DockButton: React.FC<{
	app: MemonWindowApp;
	label: string;
	open?: MemonWindowState;
	active: boolean;
	compact: boolean;
	disabled?: boolean;
	reason?: string;
	onClick: () => void;
}> = ({ app, label, open, active, compact, disabled, reason, onClick }) => {
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
			className={cn(
				"group relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
				compact ? "h-10 w-10" : "h-12 min-w-[60px]",
				active
					? "bg-blue-500/10 text-foreground"
					: open
						? "text-foreground hover:bg-muted"
						: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<span
				className={cn(
					"flex h-6 w-6 items-center justify-center rounded-md transition-transform duration-150 group-hover:-translate-y-px group-disabled:translate-y-0 motion-reduce:transition-none",
					MEMON_APP_TINTS[app],
				)}
			>
				<Icon size={14} />
			</span>
			{!compact ? (
				<span className="max-w-[72px] truncate leading-tight">{label}</span>
			) : null}
			{open ? (
				<span
					className={cn(
						"absolute bottom-px h-[3px] rounded-full",
						active ? "w-4 bg-blue-500" : "w-1 bg-muted-foreground/60",
					)}
				/>
			) : null}
		</button>
	);
};

const windowTitle = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
	t: (key: string) => string,
): string => {
	switch (window.app) {
		case "browser": {
			const tab = snapshot.browser.tabs.find(
				(candidate) => candidate.id === snapshot.browser.activeTabId,
			);
			return tab?.title || tab?.url || t("memonComputer.apps.browser");
		}
		case "files":
			return `${t("memonComputer.apps.files")} · ${memonDisplayPath(snapshot.files.cwd, snapshot.home)}`;
		case "editor":
			return `${t("memonComputer.apps.editor")} · ${snapshot.editor.path?.split("/").pop() ?? ""}${snapshot.editor.saved ? "" : " •"}`;
		case "viewer":
			return `${t("memonComputer.apps.viewer")} · ${snapshot.viewer.path?.split("/").pop() ?? ""}`;
		case "notes": {
			const done = snapshot.notes.items.filter(
				(item) => item.status === "done",
			).length;
			const file = snapshot.notes.path?.split("/").pop();
			return `${t("memonComputer.apps.notes")}${file ? ` · ${file}` : ""} · ${done}/${snapshot.notes.items.length}`;
		}
		case "scheduler":
			return `${t("memonComputer.apps.scheduler")} · ${snapshot.scheduler.agentName ?? ""}`;
		case "studio":
			return t("memonComputer.apps.studio");
		case "skills":
			return t("memonComputer.apps.skills");
		case "connections":
			return t("memonComputer.apps.connections");
		case "terminal":
			return `${t("memonComputer.apps.terminal")} · ${memonDisplayPath(snapshot.terminal.cwd, snapshot.home)}`;
		case "visualize":
			return snapshot.visual.path
				? `${t("memonComputer.apps.visualize")} · ${snapshot.visual.title}`
				: t("memonComputer.apps.visualize");
	}
};

const useElementWidth = (ref: React.RefObject<HTMLElement | null>): number => {
	const [width, setWidth] = React.useState(0);
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) =>
			setWidth(entry.contentRect.width),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
};

/**
 * The MemonOS Bot computer: the agent's windows, drawn from the same snapshot
 * its screen text is built from. Any input here goes to the machine as the
 * user; input while the agent is acting takes the computer over first.
 */
export const MemonComputerPanel: React.FC<{
	machineKey: string | null;
	/** Shown while there is no computer, e.g. a way to start one. */
	emptyState?: React.ReactNode;
}> = ({ machineKey, emptyState }) => {
	const { t } = useTranslation("common");
	const snapshot = useMemonMachineStore((state) =>
		machineKey ? state.snapshots[machineKey] : undefined,
	);
	const pull = useMemonMachineStore((state) => state.pull);
	const send = useMemonMachineStore((state) => state.send);
	const error = useMemonMachineStore((state) => state.error);
	const clearError = useMemonMachineStore((state) => state.clearError);
	const [view, setView] = React.useState<"desktop" | "text">("desktop");
	const desktopRef = React.useRef<HTMLDivElement>(null);
	// Desktop plus dock: where the user's own cursor is drawn.
	const areaRef = React.useRef<HTMLDivElement>(null);
	const [capturing, setCapturing] = React.useState(false);
	const [captureError, setCaptureError] = React.useState<string | null>(null);
	const [captureMode, setCaptureMode] = React.useState<
		"window" | "area" | null
	>(null);
	const cancelCapture = React.useCallback(() => setCaptureMode(null), []);
	const width = useElementWidth(desktopRef);
	const compact = width > 0 && width < COMPACT_WIDTH;
	const askMenu = useMemonAskMenu(snapshot, desktopRef);
	useMemonExportDownloads(snapshot?.files.exported);

	React.useEffect(() => {
		if (machineKey) void pull(machineKey);
	}, [machineKey, pull]);

	if (!machineKey || !snapshot) {
		if (emptyState) return <>{emptyState}</>;
		return (
			<div className="flex h-full items-center justify-center p-4">
				<div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
					<Monitor size={20} />
					<p>{t("memonComputer.empty")}</p>
				</div>
			</div>
		);
	}

	const key = snapshot.key;
	const userDriving = snapshot.driver === "user";
	const agentActive =
		snapshot.status === "working" || snapshot.status === "paused";
	const focused = snapshot.windows.find(
		(window) => window.id === snapshot.focusedWindowId && !window.minimized,
	);
	const visibleWindows = snapshot.windows.filter(
		(window) => !window.minimized && (!compact || window === focused),
	);
	const enabledApps = snapshot.apps.filter((app) => app.enabled);
	// The agent's apps, then the built-in ones.
	const launchers: Array<{
		id: MemonWindowApp;
		available: boolean;
		reason?: string;
	}> = [
		...enabledApps.map(({ id, available, reason }) => ({
			id,
			available,
			reason,
		})),
		...MEMON_BUILTIN_APPS.map((id) => ({ id, available: true })),
	];

	const renderBody = (window: MemonWindowState) => {
		switch (window.app) {
			case "browser":
				return (
					<BrowserWindow
						machineKey={key}
						browser={snapshot.browser}
						servers={snapshot.terminal.servers ?? []}
						send={send}
					/>
				);
			case "files":
				return (
					<FilesWindow
						machineKey={key}
						files={snapshot.files}
						home={snapshot.home}
						send={send}
					/>
				);
			case "editor":
				return (
					<EditorWindow machineKey={key} editor={snapshot.editor} send={send} />
				);
			case "viewer":
				return <ViewerWindow viewer={snapshot.viewer} />;
			case "notes":
			case "scheduler":
			case "studio":
			case "skills":
			case "connections":
				return (
					<KitWindow
						app={window.app}
						machineKey={key}
						snapshot={snapshot}
						send={send}
					/>
				);
			case "visualize":
				return (
					<VisualizeWindow
						machineKey={key}
						visual={snapshot.visual}
						home={snapshot.home}
						send={send}
					/>
				);
			case "terminal":
				return (
					<TerminalWindow
						machineKey={key}
						terminal={snapshot.terminal}
						home={snapshot.home}
						send={send}
					/>
				);
		}
	};

	const openApp = (app: MemonWindowApp) => {
		const existing = snapshot.windows.find((window) => window.app === app);
		if (
			existing &&
			!existing.minimized &&
			existing.id === snapshot.focusedWindowId
		) {
			void send("window.minimize", { key, windowId: existing.id });
		} else if (existing) {
			void send("window.focus", { key, windowId: existing.id });
		} else {
			void send("window.open", { key, app });
		}
	};

	/**
	 * A picture of the desktop, one window, or an area of the desktop,
	 * attached to the chat composer.
	 */
	const sendScreenshot = async (crop?: CaptureCrop, front?: string) => {
		const desktop = desktopRef.current;
		if (!desktop || capturing) return;
		setCaptureMode(null);
		setCapturing(true);
		try {
			const ref = await captureComputerScreen(desktop, crop, front);
			useShellLayoutStore.getState().setChatShellCollapsed(false);
			useWorkspaceModeStore.getState().sendDocumentRefsToChat([ref]);
		} catch (reason) {
			logError("[MEMON] Screenshot failed:", reason);
			setCaptureError(
				reason instanceof Error ? reason.message : String(reason),
			);
		} finally {
			setCapturing(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-2">
				<div className="flex min-w-0 items-center gap-2.5">
					<MemonLogo size={26} />
					<span className="text-sm font-semibold tracking-tight">
						{t("memonComputer.title")}
					</span>
					<StatusPill
						tone={statusTone(snapshot.status, userDriving)}
						label={t(`memonComputer.status.${snapshot.status}`)}
					/>
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					<Tabs
						value={view}
						onValueChange={(value) => {
							setCaptureMode(null);
							setView(value as "desktop" | "text");
						}}
					>
						{/* Same 32px height as the buttons beside it; segments fill it exactly. */}
						<TabsList className="h-8 gap-0.5 rounded-md p-0.5">
							<TabsTrigger value="desktop" className={SEGMENT}>
								{t("memonComputer.desktopView")}
							</TabsTrigger>
							<TabsTrigger value="text" className={SEGMENT}>
								{t("memonComputer.screenTextView")}
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className={QUIET_BUTTON}
								disabled={capturing}
							>
								{capturing ? (
									<Loader2 size={13} className="animate-spin" />
								) : (
									<MessageSquarePlus size={13} />
								)}
								{t("memonComputer.sendToChat")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => void sendScreenshot()}>
								<Camera size={14} />
								{t("memonComputer.sendScreenshot")}
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={view !== "desktop"}
								onSelect={() => setCaptureMode("window")}
							>
								<AppWindow size={14} />
								{t("memonComputer.sendWindowShot")}
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={view !== "desktop"}
								onSelect={() => setCaptureMode("area")}
							>
								<Crop size={14} />
								{t("memonComputer.sendAreaShot")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() =>
									askInChat(
										{
											kind: "text",
											source: t("memonComputer.screenTextView"),
											text: serializeScreen(snapshot),
										},
										t,
									)
								}
							>
								<FileText size={14} />
								{t("memonComputer.sendScreenText")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
					{userDriving ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className={MEMON_BUTTON}
							onClick={() => void send("control.resume", { key })}
						>
							<Play size={13} />
							{t("sandboxPanel.managedBrowserResume")}
						</Button>
					) : agentActive ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className={
									snapshot.status === "paused" ? MEMON_BUTTON : QUIET_BUTTON
								}
								onClick={() =>
									void send(
										snapshot.status === "paused"
											? "control.resume"
											: "control.pause",
										{ key },
									)
								}
							>
								{snapshot.status === "paused" ? (
									<Play size={13} />
								) : (
									<Pause size={13} />
								)}
								{snapshot.status === "paused"
									? t("memonComputer.resume")
									: t("memonComputer.pause")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className={
									snapshot.status === "paused" ? QUIET_BUTTON : YOU_BUTTON
								}
								onClick={() => void send("control.takeover", { key })}
							>
								<Hand size={13} />
								{t("sandboxPanel.managedBrowserTakeover")}
							</Button>
						</>
					) : null}
					{snapshot.status !== "working" ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8 rounded-md text-[13px] text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
							onClick={() => void send("machine.stop", { key })}
						>
							<Power size={13} />
							{t("memonComputer.shutDown")}
						</Button>
					) : null}
				</div>
			</div>

			{captureError ? (
				<button
					type="button"
					onClick={() => setCaptureError(null)}
					className="border-b border-red-600/20 bg-red-600/5 px-4 py-1.5 text-left text-xs text-red-700 dark:text-red-300"
				>
					{t("memonComputer.screenshotFailed", { error: captureError })}
				</button>
			) : null}
			{error ? (
				<button
					type="button"
					onClick={clearError}
					className="border-b border-red-600/20 bg-red-600/5 px-4 py-1.5 text-left text-xs text-red-700 dark:text-red-300"
				>
					{error}
				</button>
			) : null}

			<div
				ref={areaRef}
				className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: right-click asks about what is under the pointer; every window's content stays reachable without it. */}
				<div
					ref={desktopRef}
					onContextMenu={askMenu.onContextMenu}
					className="relative min-h-0 flex-1 overflow-hidden bg-muted/30 bg-[image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:22px_22px]"
				>
					{view === "text" ? (
						<pre className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words bg-background px-5 py-4 font-mono text-xs leading-relaxed text-foreground/90">
							{serializeScreen(snapshot)}
						</pre>
					) : (
						<>
							<MemonDesktopIcons
								entries={snapshot.desktop}
								onOpen={(path) => void send("files.open", { key, path })}
							/>
							{visibleWindows.map((window) => (
								<MemonWindowFrame
									key={window.id}
									window={window}
									title={windowTitle(snapshot, window, t)}
									focused={window.id === snapshot.focusedWindowId}
									userDriving={userDriving}
									compact={compact}
									desktopRef={desktopRef}
									onFocus={() => {
										if (window.id !== snapshot.focusedWindowId) {
											void send("window.focus", { key, windowId: window.id });
										}
									}}
									onMinimize={() =>
										void send("window.minimize", { key, windowId: window.id })
									}
									onMaximize={() =>
										void send("window.maximize", { key, windowId: window.id })
									}
									onClose={() =>
										void send("window.close", { key, windowId: window.id })
									}
									onMove={(rect) =>
										void send("window.move", { key, windowId: window.id, rect })
									}
									onAsk={
										memonWindowTarget(snapshot, window)
											? () => {
													const target = memonWindowTarget(snapshot, window);
													if (target) askInChat(target, t);
												}
											: undefined
									}
								>
									<MemonWindowErrorBoundary
										key={window.id}
										labels={{
											failed: t("memonComputer.windowFailed"),
											retry: t("memonComputer.windowRetry"),
										}}
									>
										{renderBody(window)}
									</MemonWindowErrorBoundary>
								</MemonWindowFrame>
							))}
							<MemonAgentCursor
								cursor={snapshot.cursor}
								visible={snapshot.status === "working"}
								desktopRef={desktopRef}
								revision={snapshot.revision}
							/>
							{captureMode ? (
								<MemonCaptureOverlay
									mode={captureMode}
									desktopRef={desktopRef}
									labels={{
										window: t("memonComputer.captureWindowHint"),
										area: t("memonComputer.captureAreaHint"),
									}}
									onWindow={(element) => {
										// The desktop drawn with this window in front, cut to
										// the window: drawing a window alone misplaces it.
										const desktop = desktopRef.current;
										const id = element.getAttribute("data-memon-window");
										if (!desktop || !id) return;
										const box = desktop.getBoundingClientRect();
										const rect = element.getBoundingClientRect();
										void sendScreenshot(
											{
												x: rect.left - box.left,
												y: rect.top - box.top,
												width: rect.width,
												height: rect.height,
											},
											`[data-memon-window="${id}"]`,
										);
									}}
									onArea={(crop) => void sendScreenshot(crop)}
									onCancel={cancelCapture}
								/>
							) : null}
						</>
					)}
					{askMenu.menu}
					{userDriving ? (
						<div className="absolute bottom-4 left-1/2 z-[9100] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-orange-400/80 bg-background/95 py-1.5 pl-3.5 pr-1.5 text-[13px] text-foreground shadow-xl shadow-black/15 backdrop-blur">
							<span className="relative flex h-2.5 w-2.5 shrink-0">
								<span className="absolute inset-0 animate-ping rounded-full bg-orange-400 opacity-60 motion-reduce:animate-none" />
								<span className="relative h-2.5 w-2.5 rounded-full bg-orange-400" />
							</span>
							<span className="truncate">{t("memonComputer.userDriving")}</span>
							<button
								type="button"
								onClick={() => void send("control.resume", { key })}
								className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{t("sandboxPanel.managedBrowserResume")}
							</button>
						</div>
					) : null}
				</div>

				<nav
					aria-label={t("memonComputer.title")}
					className={cn(
						"flex shrink-0 items-center overflow-x-auto overflow-y-hidden border-t bg-background px-2",
						compact ? "h-12" : "h-14",
					)}
				>
					<div className="mx-auto flex items-center gap-1">
						{launchers.map((app) => {
							const windowApp: MemonWindowApp = app.id;
							const open = snapshot.windows.find(
								(window) => window.app === windowApp,
							);
							return (
								<DockButton
									key={app.id}
									app={windowApp}
									label={t(`memonComputer.apps.${app.id}`)}
									open={open}
									active={Boolean(
										open &&
											open.id === snapshot.focusedWindowId &&
											!open.minimized,
									)}
									compact={compact}
									disabled={!app.available}
									reason={app.reason}
									onClick={() => openApp(windowApp)}
								/>
							);
						})}
						{snapshot.windows.some((window) => window.app === "editor") ? (
							<DockButton
								app="editor"
								label={t("memonComputer.apps.editor")}
								open={snapshot.windows.find(
									(window) => window.app === "editor",
								)}
								active={snapshot.windows.some(
									(window) =>
										window.app === "editor" &&
										window.id === snapshot.focusedWindowId &&
										!window.minimized,
								)}
								compact={compact}
								onClick={() => openApp("editor")}
							/>
						) : null}
					</div>
				</nav>
				<MemonUserCursor
					areaRef={areaRef}
					enabled={view === "desktop" && !captureMode}
					label={t("memonComputer.you")}
				/>
			</div>
		</div>
	);
};
