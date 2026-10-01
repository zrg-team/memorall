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
import { CommandStatusBadge } from "@/main/components/molecules/RuntimeSessions/SharedComponents";
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
import { MemonAgentCursor } from "./MemonAgentCursor";
import { MemonDesktopIcons } from "./MemonDesktopIcons";
import { MEMON_APP_ICONS, MemonWindowFrame } from "./MemonWindowFrame";
import { BrowserWindow } from "./windows/BrowserWindow";
import { EditorWindow } from "./windows/EditorWindow";
import { FilesWindow } from "./windows/FilesWindow";
import { TerminalWindow } from "./windows/TerminalWindow";
import { MemonWindowErrorBoundary } from "./MemonWindowErrorBoundary";
import { ViewerWindow } from "./windows/ViewerWindow";
import { KitWindow } from "./windows/KitWindow";
import { VisualizeWindow } from "./windows/VisualizeWindow";
import { useMemonAskMenu } from "./use-memon-ask-menu";

const COMPACT_WIDTH = 600;

const STATUS_BADGE: Record<MemonStatus, string> = {
	working: "running",
	idle: "completed",
	paused: "stopped",
	"waiting-for-user": "stopped",
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
			return `${t("memonComputer.apps.notes")} · ${done}/${snapshot.notes.items.length}`;
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
			return `${t("memonComputer.apps.terminal")} · ${snapshot.terminal.cwd}`;
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
	const [capturing, setCapturing] = React.useState(false);
	const [captureError, setCaptureError] = React.useState<string | null>(null);
	const [captureMode, setCaptureMode] = React.useState<
		"window" | "area" | null
	>(null);
	const cancelCapture = React.useCallback(() => setCaptureMode(null), []);
	const width = useElementWidth(desktopRef);
	const compact = width > 0 && width < COMPACT_WIDTH;
	const askMenu = useMemonAskMenu(snapshot, desktopRef);

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
			<div className="flex flex-wrap items-center gap-2 border-b bg-muted/10 px-4 py-2.5">
				<CommandStatusBadge
					status={STATUS_BADGE[snapshot.status]}
					label={t(`memonComputer.status.${snapshot.status}`)}
				/>
				<span className="text-xs font-medium">{t("memonComputer.title")}</span>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					<Tabs
						value={view}
						onValueChange={(value) => {
							setCaptureMode(null);
							setView(value as "desktop" | "text");
						}}
					>
						<TabsList className="h-8">
							<TabsTrigger value="desktop" className="px-3 text-xs">
								{t("memonComputer.desktopView")}
							</TabsTrigger>
							<TabsTrigger value="text" className="px-3 text-xs">
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
								className="h-8 text-xs"
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
					{userDriving ? (
						<Button
							type="button"
							size="sm"
							className="h-8 text-xs"
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
								className="h-8 text-xs"
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
								className="h-8 text-xs"
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
							variant="outline"
							size="sm"
							className="h-8 text-xs"
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

			<div className="relative flex min-h-0 flex-1 flex-col">
				{/* biome-ignore lint/a11y/noStaticElementInteractions: right-click asks about what is under the pointer; every window's content stays reachable without it. */}
				<div
					ref={desktopRef}
					onContextMenu={askMenu.onContextMenu}
					className="relative min-h-0 flex-1 overflow-hidden bg-muted/20"
				>
					{view === "text" ? (
						<pre className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words bg-background px-4 py-3 font-mono text-[11px] leading-relaxed">
							{serializeScreen(snapshot)}
						</pre>
					) : (
						<>
							<MemonDesktopIcons
								entries={snapshot.desktop}
								onOpen={(path) => void send("files.open", { key, path })}
							/>
							{!visibleWindows.length ? (
								<div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
									<span>{t("memonComputer.emptyDesktop")}</span>
									<div className="flex flex-wrap justify-center gap-2">
										{launchers.map((app) => {
											const Icon = MEMON_APP_ICONS[app.id];
											return (
												<button
													type="button"
													key={app.id}
													disabled={!app.available}
													title={app.available ? undefined : app.reason}
													onClick={() => openApp(app.id)}
													className="flex w-20 flex-col items-center gap-1.5 rounded-md border border-transparent px-2 py-2 font-medium text-foreground transition-colors hover:border-border hover:bg-background disabled:opacity-50"
												>
													<span className="flex h-9 w-9 items-center justify-center rounded-md border bg-background">
														<Icon size={16} />
													</span>
													{t(`memonComputer.apps.${app.id}`)}
												</button>
											);
										})}
									</div>
								</div>
							) : null}
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
						<div className="absolute bottom-3 right-3 z-[9100] flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-zinc-900/95 py-1.5 pl-3 pr-1.5 text-xs text-zinc-100 shadow-lg">
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
							<span className="truncate">{t("memonComputer.userDriving")}</span>
							<button
								type="button"
								onClick={() => void send("control.resume", { key })}
								className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 font-semibold text-zinc-900"
							>
								{t("sandboxPanel.managedBrowserResume")}
							</button>
						</div>
					) : null}
				</div>

				<div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t bg-background px-2">
					{launchers.map((app) => {
						const windowApp: MemonWindowApp = app.id;
						const Icon = MEMON_APP_ICONS[windowApp];
						const open = snapshot.windows.find(
							(window) => window.app === windowApp,
						);
						const active =
							open && open.id === snapshot.focusedWindowId && !open.minimized;
						return (
							<button
								type="button"
								key={app.id}
								disabled={!app.available}
								title={app.available ? undefined : app.reason}
								onClick={() => openApp(windowApp)}
								className={cn(
									"flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium transition-colors disabled:opacity-50",
									active
										? "border-blue-500/30 bg-blue-500/10 text-blue-500"
										: open
											? "text-foreground hover:bg-muted"
											: "text-muted-foreground hover:bg-muted",
								)}
							>
								<Icon size={14} />
								{!compact ? t(`memonComputer.apps.${app.id}`) : null}
								{open ? (
									<span className="font-mono text-[10px] text-muted-foreground">
										{open.id}
									</span>
								) : null}
							</button>
						);
					})}
					{snapshot.windows.some((window) => window.app === "editor") ? (
						<button
							type="button"
							onClick={() => openApp("editor")}
							className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-muted"
						>
							{React.createElement(MEMON_APP_ICONS.editor, { size: 14 })}
							{!compact ? t("memonComputer.apps.editor") : null}
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
};
