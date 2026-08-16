import React, { useState, useSyncExternalStore } from "react";
import { Database, Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Switch } from "@/main/components/ui/switch";
import type { BrowserAutomationControl } from "@/platform/contracts/core";

export const ManagedBrowserCard: React.FC<{
	control: BrowserAutomationControl;
}> = ({ control }) => {
	const { t } = useTranslation();
	const status = useSyncExternalStore(
		(listener) => control.subscribe(listener),
		() => control.getSnapshot(),
		() => control.getSnapshot(),
	);
	const [pending, setPending] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	const run = async (action: () => Promise<unknown>) => {
		setPending(true);
		setActionError(null);
		try {
			await action();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(false);
		}
	};

	const confirmRestart = () =>
		status.activeSessions === 0 ||
		window.confirm(t("sandboxPanel.managedBrowserRestartWarning"));

	return (
		<div className="overflow-hidden rounded-md border border-border">
			<div className="flex items-center gap-2 bg-muted/20 px-3 py-2.5">
				<span
					className={`h-2 w-2 rounded-full ${
						status.readiness === "ready"
							? "bg-emerald-500"
							: ["initializing", "degraded", "needs-user"].includes(
										status.readiness,
									)
								? "bg-amber-500"
								: "bg-destructive"
					}`}
				/>
				<div className="min-w-0 flex-1">
					<div className="text-xs font-semibold">
						{t("sandboxPanel.managedBrowserTitle")}
					</div>
					<div className="text-[11px] text-muted-foreground">
						{t(`sandboxPanel.managedBrowser.${status.readiness}`)}
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 px-2 text-xs"
					disabled={pending}
					onClick={() => void run(() => control.refresh())}
				>
					{pending ? (
						<Loader2 size={13} className="animate-spin" />
					) : (
						<RefreshCw size={13} />
					)}
					{t("sandboxPanel.refresh")}
				</Button>
			</div>

			<div className="space-y-3 p-3">
				<div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-5">
					<div className="rounded bg-muted/40 p-2">
						<div className="text-muted-foreground">
							{t("sandboxPanel.managedBrowserEngine")}
						</div>
						<div className="mt-0.5 font-mono font-medium">
							{status.engine ?? "—"}
						</div>
					</div>
					<div className="rounded bg-muted/40 p-2">
						<div className="text-muted-foreground">
							{t("sandboxPanel.managedBrowserEngineVersion")}
						</div>
						<div className="mt-0.5 truncate font-mono font-medium">
							{status.engineVersion ?? "—"}
						</div>
					</div>
					<div className="rounded bg-muted/40 p-2">
						<div className="text-muted-foreground">
							{t("sandboxPanel.managedBrowserRenderer")}
						</div>
						<div className="mt-0.5 truncate font-mono font-medium">
							{status.rendererVersion ?? "—"}
						</div>
					</div>
					<div className="rounded bg-muted/40 p-2">
						<div className="text-muted-foreground">
							{t("sandboxPanel.managedBrowserSessions")}
						</div>
						<div className="mt-0.5 font-medium">{status.activeSessions}</div>
					</div>
					<div className="rounded bg-muted/40 p-2">
						<div className="text-muted-foreground">
							{t("sandboxPanel.managedBrowserProfile")}
						</div>
						<div className="mt-0.5 font-medium">
							{status.persistProfile
								? t("sandboxPanel.managedBrowserPersistent")
								: t("sandboxPanel.managedBrowserEphemeral")}
						</div>
					</div>
				</div>

				<div className="flex flex-wrap gap-1.5">
					{status.engines.map((engine) => (
						<span
							key={engine.engine}
							title={engine.failure?.message}
							className={`rounded-full border px-2 py-0.5 text-[10px] ${
								engine.readiness === "ready"
									? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
									: "border-border text-muted-foreground"
							}`}
						>
							{t(`sandboxPanel.managedBrowserEngines.${engine.engine}`)} ·{" "}
							{engine.readiness}
						</span>
					))}
				</div>

				{status.sessions.length > 0 ? (
					<div className="space-y-1.5 rounded border border-border/60 p-2">
						{status.sessions.map((session) => (
							<div
								key={session.tabId}
								className="flex items-center gap-2 text-[11px]"
							>
								<span className="min-w-0 flex-1 truncate" title={session.url}>
									#{session.tabId} · {session.engine} · {session.url}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-7 px-2 text-[10px]"
									disabled={pending}
									onClick={() =>
										void run(() =>
											session.paused
												? control.resume(session.tabId)
												: control.takeover(session.tabId),
										)
									}
								>
									{session.paused
										? t("sandboxPanel.managedBrowserResume")
										: t("sandboxPanel.managedBrowserTakeover")}
								</Button>
							</div>
						))}
					</div>
				) : null}

				<label className="flex items-center justify-between gap-3 rounded border border-border/60 px-3 py-2">
					<span className="flex min-w-0 items-center gap-2">
						<Eye size={14} className="text-muted-foreground" />
						<span>
							<span className="block text-xs font-medium">
								{t("sandboxPanel.managedBrowserVisible")}
							</span>
							<span className="block text-[11px] text-muted-foreground">
								{t("sandboxPanel.managedBrowserVisibleDescription")}
							</span>
						</span>
					</span>
					<Switch
						checked={status.visible}
						disabled={pending}
						onCheckedChange={(visible) => {
							if (!confirmRestart()) return;
							void run(() =>
								control.configure({
									visible,
									persistProfile: status.persistProfile,
								}),
							);
						}}
					/>
				</label>

				<label className="flex items-center justify-between gap-3 rounded border border-border/60 px-3 py-2">
					<span className="flex min-w-0 items-center gap-2">
						<Database size={14} className="text-muted-foreground" />
						<span>
							<span className="block text-xs font-medium">
								{t("sandboxPanel.managedBrowserKeepData")}
							</span>
							<span className="block text-[11px] text-muted-foreground">
								{t("sandboxPanel.managedBrowserKeepDataDescription")}
							</span>
						</span>
					</span>
					<Switch
						checked={status.persistProfile}
						disabled={pending}
						onCheckedChange={(persistProfile) => {
							if (!confirmRestart()) return;
							void run(() =>
								control.configure({
									persistProfile,
									visible: status.visible,
								}),
							);
						}}
					/>
				</label>

				<div className="flex justify-end">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1.5 text-xs text-destructive"
						disabled={pending}
						onClick={() => {
							if (
								!window.confirm(t("sandboxPanel.managedBrowserClearWarning"))
							) {
								return;
							}
							void run(() => control.clearProfile());
						}}
					>
						<Trash2 size={13} />
						{t("sandboxPanel.managedBrowserClear")}
					</Button>
				</div>

				{status.failure || actionError ? (
					<div className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
						{actionError ??
							`${status.failure?.code}: ${status.failure?.message}`}
					</div>
				) : null}
			</div>
		</div>
	);
};
