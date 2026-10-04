import React from "react";
import { useTranslation } from "react-i18next";
import type { UsageSlice } from "../types";
import { tokenMix } from "../utils/usage-aggregate";
import { formatPercent, formatTokens } from "../utils/usage-format";
import { ChartTooltip, Legend, UsageCard } from "./chart-primitives";
import type { UsageViewContext } from "./usage-view";

/** One 100% bar of where the tokens went: fresh input, cache, output, reasoning. */
export const TokenMixCard: React.FC<{
	current: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, view }) => {
	const { t } = useTranslation("usage");
	const { palette } = view;
	const [hover, setHover] = React.useState<{
		key: string;
		x: number;
		y: number;
	} | null>(null);
	const mix = React.useMemo(() => tokenMix(current), [current]);
	const parts = [
		{
			key: "input",
			name: t("mix.input"),
			value: mix.input,
			color: palette.series[0],
		},
		{
			key: "cached",
			name: t("mix.cached"),
			value: mix.cached,
			color: palette.series[1],
		},
		{
			key: "output",
			name: t("mix.output"),
			value: mix.output,
			color: palette.series[2],
		},
		{
			key: "reasoning",
			name: t("mix.reasoning"),
			value: mix.reasoning,
			color: palette.series[3],
		},
	].map((part) => ({ ...part, color: part.color ?? palette.other }));
	const total = parts.reduce((sum, part) => sum + part.value, 0);
	const hovered = parts.find((part) => part.key === hover?.key);

	return (
		<UsageCard title={t("mix.title")} subtitle={t("mix.subtitle")}>
			{total <= 0 ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : (
				<div className="relative">
					<Legend items={parts} />
					<div className="flex h-5 gap-0.5">
						{parts
							.filter((part) => part.value > 0)
							.map((part) => {
								const share = part.value / total;
								return (
									<div
										key={part.key}
										className="flex min-w-[2px] items-center justify-center last:rounded-r"
										style={{ flex: `${share} 1 0`, background: part.color }}
										onPointerMove={(event) => {
											const box =
												event.currentTarget.parentElement?.getBoundingClientRect();
											setHover({
												key: part.key,
												x: box ? event.clientX - box.left : 0,
												y: box ? event.clientY - box.top + 28 : 0,
											});
										}}
										onPointerLeave={() => setHover(null)}
									>
										{share >= 0.09 ? (
											<span className="pointer-events-none text-[11px] font-semibold text-[#0b0b0b]">
												{formatPercent(share)}
											</span>
										) : null}
									</div>
								);
							})}
					</div>
					<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{parts.map((part) => (
							<div
								key={part.key}
								className="flex items-center justify-between gap-2"
							>
								<dt className="text-muted-foreground">{part.name}</dt>
								<dd className="m-0 tabular-nums">
									{formatTokens(part.value)}{" "}
									<span className="text-muted-foreground">
										{formatPercent(part.value / total)}
									</span>
								</dd>
							</div>
						))}
					</dl>
					{hovered && hover ? (
						<ChartTooltip
							x={hover.x}
							y={hover.y}
							content={{
								title: hovered.name,
								rows: [
									{
										color: hovered.color,
										value: formatTokens(hovered.value),
										label: formatPercent(hovered.value / total),
									},
								],
							}}
						/>
					) : null}
				</div>
			)}
		</UsageCard>
	);
};
