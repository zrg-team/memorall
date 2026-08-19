import React from "react";
import { ShieldAlert, Loader2, ExternalLink, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/main/components/ui/button";
import { serviceManager } from "@/services";
import { platform } from "@/platform/current";
import { useWebChallengeHandoffStore } from "@/main/stores/web-challenge-handoff";
import { logError } from "@/utils/logger";

export interface WebBlockDetails {
	kind: string;
	marker: string;
	description?: string;
}

interface WebChallengeNoticeProps {
	blocked: WebBlockDetails;
	sessionId?: string;
	tabId?: number;
	url?: string;
}

/**
 * Shown when a web tool reports that the page it reached is a bot wall rather
 * than the requested content.
 *
 * The point is the handoff: the user has a real browser profile with real
 * cookies and real hands, so the wall that stops the agent is usually trivial
 * for them. On the extension we raise the session's own tab; on desktop we take
 * the managed browser over, which needs a visible window and therefore a
 * confirmation, because switching visibility restarts the runtime and closes
 * every open session.
 */
export const WebChallengeNotice: React.FC<WebChallengeNoticeProps> = ({
	blocked,
	sessionId,
	tabId,
	url,
}) => {
	const { t } = useTranslation("chat");
	const [pending, setPending] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [handedOver, setHandedOver] = React.useState(false);
	const requestContinuation = useWebChallengeHandoffStore(
		(state) => state.requestContinuation,
	);

	const automation = platform.browserAutomation;

	const run = async (action: () => Promise<unknown>) => {
		setPending(true);
		setError(null);
		try {
			await action();
			return true;
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setError(message);
			logError("Web challenge handoff failed:", caught);
			return false;
		} finally {
			setPending(false);
		}
	};

	const handOverOnDesktop = async () => {
		if (!automation) return;
		const status = automation.getSnapshot();

		if (!status.visible) {
			// Making the browser visible restarts it, which closes every session —
			// including the blocked one — so the page has to be reopened afterwards.
			// Never do that silently: it discards work the agent may still be using.
			if (!window.confirm(t("webChallenge.desktopVisibleConfirm"))) return;
			await automation.configure({
				visible: true,
				persistProfile: status.persistProfile,
			});
			if (!url) {
				throw new Error(t("webChallenge.missingUrl"));
			}
			const reopened = await serviceManager
				.getWebBrowserService()
				.openSession({ url, mode: "window", persist: true });
			const reopenedTabId = reopened.session.tabId;
			if (typeof reopenedTabId !== "number") {
				throw new Error(t("webChallenge.missingTab"));
			}
			await automation.takeover(reopenedTabId);
			return;
		}

		if (typeof tabId !== "number") {
			throw new Error(t("webChallenge.missingTab"));
		}
		await automation.takeover(tabId);
	};

	const handOverOnExtension = async () => {
		if (!sessionId) {
			throw new Error(t("webChallenge.missingSession"));
		}
		await serviceManager.getWebBrowserService().focusSession(sessionId);
	};

	const handleHandOver = async () => {
		const ok = await run(() =>
			automation ? handOverOnDesktop() : handOverOnExtension(),
		);
		if (ok) setHandedOver(true);
	};

	const handleSolved = async () => {
		// Desktop pauses the session on takeover, which makes every agent operation
		// on it fail until it is released.
		if (automation && typeof tabId === "number") {
			await run(() => automation.resume(tabId));
		}
		requestContinuation(t("webChallenge.continuePrompt", { url: url ?? "" }));
	};

	return (
		<div
			className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
			data-testid="web-challenge-notice"
		>
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold text-foreground">
						{t(`webChallenge.kind.${blocked.kind}`, {
							defaultValue: t("webChallenge.kind.default"),
						})}
					</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{blocked.description ?? t("webChallenge.genericDescription")}
					</p>

					<div className="mt-2.5 flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="h-7 gap-1.5 px-2 text-[11px]"
							disabled={pending}
							onClick={() => void handleHandOver()}
						>
							{pending ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<ExternalLink className="h-3 w-3" />
							)}
							{t("webChallenge.solveItMyself")}
						</Button>

						{handedOver ? (
							<Button
								type="button"
								size="sm"
								className="h-7 gap-1.5 px-2 text-[11px]"
								disabled={pending}
								onClick={() => void handleSolved()}
							>
								<Check className="h-3 w-3" />
								{t("webChallenge.iHaveSolvedIt")}
							</Button>
						) : null}
					</div>

					{handedOver ? (
						<p className="mt-2 text-[11px] text-muted-foreground">
							{t("webChallenge.handedOverHint")}
						</p>
					) : null}

					{error ? (
						<p className="mt-2 break-words text-[11px] text-red-600">{error}</p>
					) : null}
				</div>
			</div>
		</div>
	);
};
