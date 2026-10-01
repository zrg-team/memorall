import { Monitor } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { useOpenMemonComputer } from "@/main/components/molecules/MemonComputer/use-open-computer";
import type {
	ActionRenderer,
	MessageActionItem,
} from "@/main/modules/chat/components/types";
import { ToolItemRawIO, ToolSection, ToolStateBadge } from "./ToolCommon";

/**
 * memon_* results are "summary line, blank line, screen". The screen is the
 * text the model read; refs ([b4], [f2]) are highlighted so a reader can
 * follow what the agent acted on.
 */
const splitMemonResult = (
	description: string,
): { summary: string; screen: string } => {
	const index = description.indexOf("\n\n");
	return index < 0
		? { summary: description, screen: "" }
		: {
				summary: description.slice(0, index),
				screen: description.slice(index + 2),
			};
};

const REF_SPLIT = /(\[[bfet]\d+\])/g;
const IS_REF = /^\[[bfet]\d+\]$/;

const ScreenText: React.FC<{ screen: string }> = ({ screen }) => (
	<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
		{screen.split(REF_SPLIT).map((part, index) =>
			IS_REF.test(part) ? (
				<span key={index} className="font-medium text-blue-500">
					{part}
				</span>
			) : (
				part
			),
		)}
	</pre>
);

const MemonToolDetails: React.FC<{ item: MessageActionItem }> = ({ item }) => {
	const { t } = useTranslation("chat");
	const openComputer = useOpenMemonComputer();
	const { summary, screen } = splitMemonResult(item.description ?? "");
	const needsApproval = summary.startsWith("Needs the user's approval");

	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md border border-border/60 bg-muted/20 p-2">
						<Monitor className="h-4 w-4 text-muted-foreground" />
					</div>
					<div className="min-w-0 flex-1 space-y-2">
						{needsApproval ? (
							<ToolStateBadge ok={false} label={t("memon.needsApproval")} />
						) : null}
						<div className="break-words text-sm font-medium text-foreground">
							{summary || t("memon.noSummary")}
						</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 shrink-0 rounded-lg px-2 text-xs"
						onClick={openComputer}
					>
						{t("memon.showOnComputer")}
					</Button>
				</div>
				{screen ? (
					<div className="mt-3 space-y-1">
						<p className="text-[11px] font-medium text-muted-foreground">
							{t("memon.screenReturned")}
						</p>
						<ScreenText screen={screen} />
					</div>
				) : null}
			</ToolSection>
			<ToolItemRawIO item={item} />
		</div>
	);
};

export const memonToolRenderer: ActionRenderer = (item, isOpen) =>
	isOpen ? <MemonToolDetails item={item} /> : null;
