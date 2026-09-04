import {
	Check,
	ExternalLink,
	Loader2,
	RotateCw,
	ShieldAlert,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/main/components/ui/button";
import { useWebChallengePromptStore } from "@/main/stores/web-challenge-prompts";
import type { WebChallengePrompt } from "@/services/web-browser/challenge-intervention";
import { logError } from "@/utils/logger";

/**
 * The card shown while a web tool is parked on a bot wall.
 *
 * Unlike the after-the-fact notice, this one is live: the agent is still on this
 * tool call and is waiting on the person reading it. So it is rendered outside
 * the run-details disclosure, and it never hides an action behind a collapsed
 * panel — an agent blocked on a person must not hide the control that unblocks
 * it.
 */
export const WebChallengePromptCard: React.FC<{
	prompt: WebChallengePrompt;
}> = ({ prompt }) => {
	const { t } = useTranslation("chat");
	const [pending, setPending] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [note, setNote] = React.useState<string | null>(null);
	const [expired, setExpired] = React.useState(false);
	const [handedOver, setHandedOver] = React.useState(false);
	/** Desktop can reopen the page during handoff, producing a new session. */
	const [replacement, setReplacement] = React.useState<{
		sessionId: string;
		tabId?: number;
	} | null>(null);

	const resolve = useWebChallengePromptStore((state) => state.resolve);
	const handOver = useWebChallengePromptStore((state) => state.handOver);
	const reloadAndCheck = useWebChallengePromptStore(
		(state) => state.reloadAndCheck,
	);

	const effectiveSessionId = replacement?.sessionId ?? prompt.sessionId;
	const effectiveTabId = replacement?.tabId ?? prompt.tabId;

	const run = async (key: string, action: () => Promise<void>) => {
		setPending(key);
		setError(null);
		try {
			await action();
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setError(message);
			logError("Web challenge action failed:", caught);
		} finally {
			setPending(null);
		}
	};

	const answer = async (outcome: "retry" | "skip") => {
		const resolved = await resolve(prompt.id, {
			outcome,
			sessionId: effectiveSessionId,
			tabId: effectiveTabId,
		});
		if (!resolved) setExpired(true);
	};

	const handleOpen = () =>
		run("open", async () => {
			const { replacement: reopened } = await handOver(
				prompt,
				effectiveSessionId,
				effectiveTabId,
				() => window.confirm(t("webChallenge.desktopVisibleConfirm")),
			);
			if (reopened) setReplacement(reopened);
			setHandedOver(true);
		});

	const handleReload = () =>
		run("reload", async () => {
			setNote(null);
			const { cleared } = await reloadAndCheck(effectiveSessionId);
			if (!cleared) {
				setNote(t("webChallenge.stillBlocked"));
				return;
			}
			// The wall is gone, so there is nothing left to ask: continue for them.
			setNote(t("webChallenge.reloadCleared"));
			await answer("retry");
		});

	const handleContinue = () => run("continue", () => answer("retry"));
	const handleSkip = () => run("skip", () => answer("skip"));

	const busy = pending !== null;

	return (
		<div
			className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
			data-testid="web-challenge-prompt"
		>
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold text-foreground">
						{t(`webChallenge.kind.${prompt.blocked.kind}`, {
							defaultValue: t("webChallenge.kind.default"),
						})}
					</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{expired
							? t("webChallenge.expired")
							: (prompt.blocked.description ??
								t("webChallenge.genericDescription"))}
					</p>

					{expired ? null : (
						<div className="mt-2.5 flex flex-wrap items-center gap-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="h-7 gap-1.5 px-2 text-[11px]"
								disabled={busy}
								onClick={() => void handleOpen()}
							>
								{pending === "open" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<ExternalLink className="h-3 w-3" />
								)}
								{t("webChallenge.solveItMyself")}
							</Button>

							<Button
								type="button"
								size="sm"
								variant="outline"
								className="h-7 gap-1.5 px-2 text-[11px]"
								disabled={busy}
								onClick={() => void handleReload()}
							>
								{pending === "reload" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<RotateCw className="h-3 w-3" />
								)}
								{t("webChallenge.reloadAndCheck")}
							</Button>

							<Button
								type="button"
								size="sm"
								className="h-7 gap-1.5 px-2 text-[11px]"
								disabled={busy}
								onClick={() => void handleContinue()}
							>
								{pending === "continue" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<Check className="h-3 w-3" />
								)}
								{t("webChallenge.iHaveSolvedIt")}
							</Button>

							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-7 gap-1.5 px-2 text-[11px]"
								disabled={busy}
								onClick={() => void handleSkip()}
							>
								<X className="h-3 w-3" />
								{t("webChallenge.stopWaiting")}
							</Button>
						</div>
					)}

					{handedOver && !expired ? (
						<p className="mt-2 text-[11px] text-muted-foreground">
							{t("webChallenge.handedOverHint")}
						</p>
					) : null}

					{note ? (
						<p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
					) : null}

					{error ? (
						<p className="mt-2 break-words text-[11px] text-red-600">{error}</p>
					) : null}
				</div>
			</div>
		</div>
	);
};
