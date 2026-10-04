import { CornerDownRight } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";

/**
 * A message the user sent while the agent worked, inside the reply where the
 * agent read it: the steps above ran before it, the ones below after. Styled
 * like the user's own bubble, a little smaller, with a note on when it landed.
 */
export const InlineUserMessage: React.FC<{ text: string }> = ({ text }) => {
	const { t } = useTranslation("chat");
	return (
		<div
			className="flex w-full flex-col items-end gap-1"
			data-testid="inline-user-message"
		>
			<div className="max-w-[min(82%,42rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-3.5 py-2 text-sm leading-relaxed text-foreground shadow-sm">
				{text}
			</div>
			<span className="flex items-center gap-1 text-[11px] text-muted-foreground">
				<CornerDownRight size={11} aria-hidden="true" />
				{t("messages.readDuringRun", "Read by the agent at its next step")}
			</span>
		</div>
	);
};
