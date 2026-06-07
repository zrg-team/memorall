import React from "react";
import { useTranslation } from "react-i18next";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/main/components/ui/hover-card";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import type { AgentConfigSummary } from "../../types";

const PromptPill: React.FC<{
	label: string;
	value: string;
	preview: string;
}> = ({ label, value, preview }) => (
	<HoverCard openDelay={120} closeDelay={60}>
		<HoverCardTrigger asChild>
			<button
				type="button"
				className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
			>
				<FileText size={11} />
				<span>
					{label} · {value}
				</span>
			</button>
		</HoverCardTrigger>
		<HoverCardContent
			align="start"
			className="w-[min(42rem,calc(100vw-2rem))] p-3"
		>
			<div className="space-y-2">
				<p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
					{label}
				</p>
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground">
					{preview}
				</pre>
			</div>
		</HoverCardContent>
	</HoverCard>
);

const FEATURE_PROMPTS_DEFAULT_VISIBLE = 5;

export const AgentPromptPills: React.FC<{
	configSummary?: AgentConfigSummary | null;
}> = ({ configSummary }) => {
	const { t } = useTranslation("agents");
	const [showAll, setShowAll] = React.useState(false);

	const featurePrompts = configSummary?.featurePrompts ?? [];
	const hiddenCount = featurePrompts.length - FEATURE_PROMPTS_DEFAULT_VISIBLE;
	const visibleFeaturePrompts =
		showAll || hiddenCount <= 0
			? featurePrompts
			: featurePrompts.slice(0, FEATURE_PROMPTS_DEFAULT_VISIBLE);

	return (
		<CursorPoint
			cursorKey={AGENT_WIZARD_CURSOR_KEYS.contextPrompt}
			className="flex flex-wrap gap-2"
		>
			<PromptPill
				label={t("summary.systemPrompt")}
				value={
					configSummary
						? t("summary.systemPromptValue", {
								count: configSummary.systemPromptLength,
								mode: configSummary.hasCustomSystemPrompt
									? t("summary.custom")
									: t("summary.default"),
							})
						: t("state.loading")
				}
				preview={configSummary?.systemPromptPreview ?? t("state.loading")}
			/>
			{visibleFeaturePrompts.map((fp) => (
				<PromptPill
					key={fp.name}
					label={fp.displayName}
					value={t("summary.featurePromptValue", { count: fp.length })}
					preview={fp.preview}
				/>
			))}
			{hiddenCount > 0 && (
				<button
					type="button"
					onClick={() => setShowAll((v) => !v)}
					className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
				>
					{showAll ? (
						<>
							<ChevronUp size={11} />
							{t("summary.showLess")}
						</>
					) : (
						<>
							<ChevronDown size={11} />+{hiddenCount} more
						</>
					)}
				</button>
			)}
		</CursorPoint>
	);
};
