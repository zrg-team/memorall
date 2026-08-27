import type React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/main/components/ui/card";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { UnsupportedReason } from "../utils/browser-support";

interface BrowserSupportNoticeProps {
	provider: ServiceProvider;
	reason: UnsupportedReason;
}

/**
 * Shown in place of a local provider's model list when this browser cannot run
 * it. Without this the provider looks available right up until a download fails
 * inside a worker with a message no one can act on.
 */
export const BrowserSupportNotice: React.FC<BrowserSupportNoticeProps> = ({
	provider,
	reason,
}) => {
	const { t } = useTranslation("llm");
	const providerName = t(`providers.${provider}`, { defaultValue: provider });

	return (
		<Card data-browser-unsupported={reason}>
			<CardContent className="flex items-start gap-3 pt-6">
				<AlertTriangle
					className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500"
					aria-hidden
				/>
				<div className="space-y-1">
					<h3 className="text-sm font-semibold">
						{t("browserSupport.title", { provider: providerName })}
					</h3>
					<p className="text-sm text-muted-foreground">
						{t(`browserSupport.reasons.${reason}`)}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("browserSupport.alternative")}
					</p>
				</div>
			</CardContent>
		</Card>
	);
};
