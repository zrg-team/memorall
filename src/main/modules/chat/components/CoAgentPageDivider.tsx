import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	type CoAgentPage,
	formatCoAgentPageLabel,
} from "../utils/coagent-timeline";

interface CoAgentPageDividerProps {
	page: CoAgentPage;
	/** True for the page a run of co-agent turns began on. */
	isFirst: boolean;
}

/**
 * Where a stretch of co-agent turns was asked.
 *
 * Quieter than the session boundary on purpose: the session pill is the header
 * for the whole stretch, and these are the steps inside it, so they should read
 * as a route rather than compete with it.
 */
export const CoAgentPageDivider = ({
	page,
	isFirst,
}: CoAgentPageDividerProps) => {
	const { t } = useTranslation();
	const label = formatCoAgentPageLabel(page);

	return (
		<div
			className="my-2 flex items-center gap-2"
			data-testid="coagent-page-divider"
		>
			<div className="h-px flex-1 bg-border/50" />
			<div
				className="inline-flex max-w-[70%] items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
				title={page.title ? `${page.title}\n${page.url}` : page.url}
			>
				<Globe className="h-2.5 w-2.5 shrink-0" />
				<span className="truncate">
					{isFirst
						? t("messages.coAgentOnPage", {
								defaultValue: "on {{page}}",
								page: label,
							})
						: t("messages.coAgentMovedTo", {
								defaultValue: "moved to {{page}}",
								page: label,
							})}
				</span>
			</div>
			<div className="h-px flex-1 bg-border/50" />
		</div>
	);
};
