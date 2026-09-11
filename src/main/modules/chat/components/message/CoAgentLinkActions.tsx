import { Bot, Loader2 } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCoAgentActivationStore } from "@/main/stores/co-agent-activation";

const hostLabel = (url: string): string => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

/**
 * Offers the co-agent on links the user pasted.
 *
 * Sits under the message rather than inside it: the message is what the user
 * said, and rewriting their text to carry a control would change the transcript.
 * One button per link, because a message can reasonably carry more than one and
 * picking for the user would be guessing.
 */
export const CoAgentLinkActions: React.FC<{ links: string[] }> = ({
	links,
}) => {
	const { t } = useTranslation("chat");
	const activate = useCoAgentActivationStore((state) => state.activate);
	const pendingUrl = useCoAgentActivationStore((state) => state.pendingUrl);
	const isActivating = useCoAgentActivationStore((state) => state.isActivating);
	const error = useCoAgentActivationStore((state) => state.error);

	if (links.length === 0) return null;

	return (
		<div className="mt-2 space-y-1.5">
			<div className="flex flex-wrap gap-1.5">
				{links.map((link) => {
					const isPending = isActivating && pendingUrl === link;
					return (
						<button
							key={link}
							type="button"
							disabled={isActivating}
							onClick={() => void activate(link)}
							title={t("coAgent.openLinkTitle", {
								url: link,
								defaultValue: `Open ${link} and turn on the co-agent`,
							})}
							className={cn(
								"inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors",
								"hover:border-primary/40 hover:bg-accent hover:text-foreground",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								"disabled:cursor-not-allowed disabled:opacity-60",
							)}
						>
							{isPending ? (
								<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
							) : (
								<Bot className="h-3.5 w-3.5 shrink-0" />
							)}
							<span className="truncate">
								{t("coAgent.openLink", {
									host: hostLabel(link),
									defaultValue: `Co-agent on ${hostLabel(link)}`,
								})}
							</span>
						</button>
					);
				})}
			</div>
			{error ? (
				<p className="text-xs text-destructive" role="status">
					{error}
				</p>
			) : null}
		</div>
	);
};
