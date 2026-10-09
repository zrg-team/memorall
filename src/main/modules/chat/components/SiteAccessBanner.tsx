import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, Loader2, LockKeyhole, X } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { useSiteAccess } from "@/main/hooks/use-site-access";

/**
 * A tab over the composer while the browser withholds Memorall's site access,
 * so the user can fix it before a web tool fails rather than after. Hidden for
 * the session once dismissed; gone by itself once access is granted, from here
 * or from the browser's extension menu.
 */
export const SiteAccessBanner: React.FC = () => {
	const { t } = useTranslation("chat");
	const { withheld, requestAllSites } = useSiteAccess();
	const [dismissed, setDismissed] = React.useState(false);
	const [asking, setAsking] = React.useState(false);
	const [declined, setDeclined] = React.useState(false);

	if (!withheld || dismissed) return null;

	const handleAllow = async () => {
		setAsking(true);
		setDeclined(false);
		try {
			setDeclined(!(await requestAllSites()));
		} finally {
			setAsking(false);
		}
	};

	return (
		<div className="relative z-30 w-full flex-shrink-0 px-4">
			<div className="mx-auto max-w-4xl">
				<div
					className="relative z-30 mx-5 -mb-px flex items-center justify-between gap-3 rounded-lg rounded-bl-none rounded-br-none border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-100"
					data-testid="site-access-banner"
				>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
							<LockKeyhole className="h-3.5 w-3.5 shrink-0" />
							<span>{t("siteAccess.bannerTitle")}</span>
						</div>
						<div className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-100/80">
							{declined
								? t("siteAccess.declined")
								: t("siteAccess.bannerDescription")}
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Button
							type="button"
							size="sm"
							disabled={asking}
							onClick={() => void handleAllow()}
							className="h-8 shrink-0 border border-amber-300 bg-amber-50 px-3 text-amber-950 hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-amber-200"
						>
							{asking ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Globe className="h-4 w-4" />
							)}
							{t("siteAccess.allow")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-label={t("siteAccess.bannerDismiss")}
							title={t("siteAccess.bannerDismiss")}
							onClick={() => setDismissed(true)}
							className="h-8 w-8 p-0 text-amber-800 hover:bg-amber-500/10 dark:text-amber-100"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};
