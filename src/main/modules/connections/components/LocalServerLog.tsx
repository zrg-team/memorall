import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A local server's stderr, newest at the bottom. Secret values are already
 * redacted by the desktop before they get here.
 */
export const LocalServerLog: React.FC<{
	lines: string[];
	className?: string;
}> = ({ lines, className }) => {
	const { t } = useTranslation("connections");
	const [copied, setCopied] = React.useState(false);
	const scrollRef = React.useRef<HTMLPreElement>(null);

	// Follow the tail, the way a terminal does.
	React.useEffect(() => {
		const element = scrollRef.current;
		if (element && lines.length > 0) element.scrollTop = element.scrollHeight;
	}, [lines]);

	const text = lines.join("\n");

	return (
		<div className={cn("space-y-1", className)}>
			<div className="flex items-center justify-between">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					{t("template.logs")}
				</span>
				<button
					type="button"
					disabled={!text}
					onClick={() => {
						void navigator.clipboard?.writeText(text).then(() => {
							setCopied(true);
							window.setTimeout(() => setCopied(false), 1_500);
						});
					}}
					className="flex items-center gap-1 rounded px-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
				>
					{copied ? <Check size={10} /> : <Copy size={10} />}
					{copied ? t("template.copied") : t("template.copyLogs")}
				</button>
			</div>
			<pre
				ref={scrollRef}
				className="max-h-48 min-h-[3rem] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
			>
				{text || t("template.noLogs")}
			</pre>
		</div>
	);
};
