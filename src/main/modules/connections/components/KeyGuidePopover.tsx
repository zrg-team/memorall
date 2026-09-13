import React from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, HelpCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { platform } from "@/platform/current";
import type { KeyGuide } from "@/services/mcp-connections";

/**
 * "Where do I get this key?", answered next to the field that asks for it.
 *
 * Every service hides its key somewhere different, under a different name,
 * and most want a setting changed before the key works (Notion pages must be
 * shared with the integration, Airtable tokens need scopes). Sending the user
 * off to search for that is where setup gets abandoned.
 */
export const KeyGuidePopover: React.FC<{
	templateId: string;
	fieldKey: string;
	guide: KeyGuide;
}> = ({ templateId, fieldKey, guide }) => {
	const { t } = useTranslation("connections");
	const base = `template.guides.${templateId}.${fieldKey}`;
	const steps = Array.from({ length: guide.steps }, (_, index) =>
		t(`${base}.step${index + 1}`),
	);
	const host = (() => {
		try {
			return new URL(guide.url).hostname.replace(/^www\./, "");
		} catch {
			return guide.url;
		}
	})();

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded px-1 text-[10px] font-medium normal-case tracking-normal text-blue-600 hover:underline dark:text-blue-400"
				>
					<HelpCircle size={11} />
					{t("template.guide.trigger")}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 space-y-3 p-3.5">
				<p className="text-xs font-semibold">{t(`${base}.title`)}</p>
				<ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
					{steps.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
				<Button
					type="button"
					size="sm"
					className="h-7 w-full rounded-lg text-[11px]"
					onClick={() => void platform.externalLinks.open(guide.url)}
				>
					<ExternalLink size={11} className="mr-1.5" />
					{t("template.guide.open", { site: host })}
				</Button>
				<p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
					<ShieldCheck size={11} className="mt-px shrink-0" />
					{t("template.guide.safety")}
				</p>
			</PopoverContent>
		</Popover>
	);
};
