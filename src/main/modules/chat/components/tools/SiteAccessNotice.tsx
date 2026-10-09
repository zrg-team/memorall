import React from "react";
import { CheckCircle2, Globe, Loader2, LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/main/components/ui/button";
import { useSiteAccess } from "@/main/hooks/use-site-access";
import { useWebChallengeHandoffStore } from "@/main/stores/web-challenge-handoff";
import { cn } from "@/lib/utils";

type Phase = "idle" | "asking" | "granted" | "declined";

/**
 * Shown on a web tool's card when the tool failed because the browser withholds
 * Memorall's site access. One click asks the browser for every site — the only
 * grant that lets the agent go on, since its next page is rarely this one — and
 * then hands the chat a prompt to carry on, the way WebChallengeNotice does.
 *
 * Renders nothing once access is back, so the card of an old failure does not
 * keep asking.
 */
export const SiteAccessNotice: React.FC<{ className?: string }> = ({
	className,
}) => {
	const { t } = useTranslation("chat");
	const { withheld, requestAllSites } = useSiteAccess();
	const requestContinuation = useWebChallengeHandoffStore(
		(state) => state.requestContinuation,
	);
	const [phase, setPhase] = React.useState<Phase>("idle");

	if (phase === "granted") {
		return (
			<div
				className={cn(
					"rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3",
					className,
				)}
				data-testid="site-access-notice"
			>
				<div className="flex items-start gap-2">
					<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold text-foreground">
							{t("siteAccess.granted")}
						</p>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{t("siteAccess.grantedHint")}
						</p>
					</div>
				</div>
			</div>
		);
	}

	if (!withheld) return null;

	const handleAllow = async () => {
		setPhase("asking");
		// Before any await: the prompt only opens inside the click.
		const granted = await requestAllSites();
		if (!granted) {
			setPhase("declined");
			return;
		}
		setPhase("granted");
		requestContinuation(t("siteAccess.continuePrompt"));
	};

	const asking = phase === "asking";
	return (
		<div
			className={cn(
				"rounded-lg border border-amber-500/30 bg-amber-500/5 p-3",
				className,
			)}
			data-testid="site-access-notice"
		>
			<div className="flex items-start gap-2">
				<LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold text-foreground">
						{t("siteAccess.title")}
					</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{t("siteAccess.description")}
					</p>
					<div className="mt-2.5 flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							className="h-7 gap-1.5 px-2 text-[11px]"
							disabled={asking}
							onClick={() => void handleAllow()}
						>
							{asking ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Globe className="h-3 w-3" />
							)}
							{t("siteAccess.allow")}
						</Button>
						<span className="text-[11px] text-muted-foreground">
							{t("siteAccess.confirmHint")}
						</span>
					</div>
					{phase === "declined" ? (
						<p className="mt-2 break-words text-[11px] text-red-600">
							{t("siteAccess.declined")}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};
