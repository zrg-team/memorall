import React, { useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { serviceManager } from "@/services";
import type { ActiveWebSessionInfo } from "./types";
import { ActionIconButton } from "./SharedComponents";
import { formatSessionTime } from "./utils";
import { platform } from "@/platform/current";

export const WebBrowserSessionCard: React.FC<{
	session: ActiveWebSessionInfo;
	onChanged: () => void | Promise<void>;
}> = ({ session, onChanged }) => {
	const { t } = useTranslation();
	const [urlInput, setUrlInput] = useState(session.currentUrl ?? "");
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isNavigating, setIsNavigating] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		setUrlInput(session.currentUrl ?? "");
	}, [session.currentUrl]);

	if (!session.isOpen) {
		return null;
	}

	const openInTab = () => {
		if (!session.currentUrl) {
			return;
		}
		void platform.externalLinks.open(session.currentUrl);
	};

	const lastAccessed = formatSessionTime(session.lastAccessedAt);
	const createdAt = formatSessionTime(session.createdAt);
	const actionBusy = isRefreshing || isNavigating || isClosing;

	const handleRefresh = async () => {
		if (!session.sessionId) {
			return;
		}
		setIsRefreshing(true);
		setActionError(null);
		try {
			await serviceManager
				.getWebBrowserService()
				.refreshSession({ sessionId: session.sessionId });
			void onChanged();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsRefreshing(false);
		}
	};

	const handleNavigate = async () => {
		const nextUrl = urlInput.trim();
		if (!nextUrl) {
			return;
		}
		setIsNavigating(true);
		setActionError(null);
		try {
			await serviceManager.getWebBrowserService().openSession({
				url: nextUrl,
				persist: true,
				mode: session.mode,
			});
			void onChanged();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsNavigating(false);
		}
	};

	const handleClose = async () => {
		if (!session.sessionId) {
			return;
		}
		setIsClosing(true);
		setActionError(null);
		try {
			await serviceManager
				.getWebBrowserService()
				.closeSession(session.sessionId);
			void onChanged();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsClosing(false);
		}
	};

	return (
		<div className="overflow-hidden rounded-md border border-border">
			<div className="flex items-center gap-2 bg-muted/20 px-2 py-2">
				<span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
					<Globe size={11} />
					{session.mode || "iframe"}
				</span>
				<span className="flex-1 truncate text-xs font-medium">
					{session.title || t("sandboxPanel.webSessionUntitled")}
				</span>
				<div className="flex items-center gap-1">
					<ActionIconButton
						title={t("sandboxPanel.openInTab")}
						onClick={openInTab}
						disabled={actionBusy}
						icon={<ExternalLink size={14} />}
					/>
					<ActionIconButton
						title={t("sandboxPanel.refreshSession")}
						onClick={() => void handleRefresh()}
						disabled={actionBusy}
						icon={
							isRefreshing ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<RefreshCw size={14} />
							)
						}
					/>
					<ActionIconButton
						title={t("sandboxPanel.closeSession")}
						onClick={() => void handleClose()}
						disabled={actionBusy}
						variant="danger"
						icon={
							isClosing ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<X size={14} />
							)
						}
					/>
				</div>
			</div>
			<div className="space-y-2 p-2">
				<div className="flex gap-1">
					<input
						type="text"
						value={urlInput}
						onChange={(e) => setUrlInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void handleNavigate()}
						placeholder={t("sandboxPanel.urlPlaceholder")}
						className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						onClick={() => void handleNavigate()}
						disabled={actionBusy || !urlInput.trim()}
						className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
					>
						{isNavigating ? (
							<Loader2 size={13} className="animate-spin" />
						) : (
							<Send size={13} />
						)}
						<span>{t("sandboxPanel.go")}</span>
					</button>
				</div>
				<div className="space-y-1">
					<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						{t("sandboxPanel.webSessionCurrentUrl")}
					</div>
					<div
						className="break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
						title={session.currentUrl}
					>
						{session.currentUrl}
					</div>
				</div>
				{session.requestedUrl && session.requestedUrl !== session.currentUrl ? (
					<div className="space-y-1">
						<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							{t("sandboxPanel.webSessionRequestedUrl")}
						</div>
						<div
							className="break-all rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground"
							title={session.requestedUrl}
						>
							{session.requestedUrl}
						</div>
					</div>
				) : null}
				<div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
					<span>{`sessionId: ${session.sessionId}`}</span>
					{lastAccessed ? (
						<span>{`${t("sandboxPanel.webSessionLastAccessed")}: ${lastAccessed}`}</span>
					) : null}
					{createdAt ? (
						<span>{`${t("sandboxPanel.webSessionCreatedAt")}: ${createdAt}`}</span>
					) : null}
				</div>
				{actionError ? (
					<div className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
						{actionError}
					</div>
				) : null}
			</div>
		</div>
	);
};
