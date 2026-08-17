import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	Check,
	Link2,
	Plus,
	Shield,
	Terminal,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { cn } from "@/lib/utils";
import { platform } from "@/platform/current";
import { AppIcon, COMPOSIO_LOGO_URL } from "./AppIcon";

export type ConnectionLane = "composio" | "template" | "custom";

/**
 * The three ways in. Rendered both as the page's empty state and inside the
 * agent picker, so it takes no layout assumptions from either.
 *
 * Composio is visually the recommendation — accent border, app tiles, filled
 * button — so a first-timer lands in the right place without reading.
 */

/**
 * A sample of what the lane reaches, drawn with the apps' real marks. The
 * letters this replaced ("G", "S", "C") named nothing — a coloured G could
 * equally have been Gmail, GitHub or Google Drive.
 */
const APP_TILES = [
	{ slug: "gmail", name: "Gmail" },
	{ slug: "slack", name: "Slack" },
	{ slug: "googlecalendar", name: "Google Calendar" },
	{ slug: "notion", name: "Notion" },
	{ slug: "linear", name: "Linear" },
];

interface AddConnectionChooserProps {
	onSelect: (lane: ConnectionLane) => void;
	className?: string;
	/** Hide the encryption footnote when the host already shows one. */
	compact?: boolean;
}

export const AddConnectionChooser: React.FC<AddConnectionChooserProps> = ({
	onSelect,
	className,
	compact = false,
}) => {
	const { t } = useTranslation("connections");

	// The local-server lane ends differently per platform, and saying so up front
	// beats discovering it after four steps.
	const canSpawnNatively = platform.capabilities.get("mcp.stdio").available;
	const isWeb = platform.environment === "web";

	return (
		// Container queries, not viewport ones: this renders full-width on the
		// page, in a ~615px column beside the onboarding panel, and inside a
		// 720px dialog. `lg:grid-cols-3` measured the window and gave all three
		// hosts three columns, so on the split page each card was ~195px and the
		// name had to fight the "Recommended" badge for room.
		<div className={cn("@container space-y-4", className)}>
			<div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
				{/* Composio */}
				<div
					className={cn(
						"flex flex-col gap-2.5 rounded-xl border p-3.5",
						isWeb
							? "border-border/60 bg-background/60 opacity-70"
							: "border-blue-500/30 bg-background/60 shadow-[0_0_0_1px_rgba(59,130,246,0.08)]",
					)}
				>
					{/* The badge wraps to its own line rather than squeezing the name:
					    "Recommended" translates longer than it reads in English, and a
					    product name shortened to "Co…" is worse than a taller card. */}
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<AppIcon name="Composio" src={COMPOSIO_LOGO_URL} size={28} />
						<span className="shrink-0 text-sm font-semibold">
							{t("lanes.composio.name")}
						</span>
						{!isWeb ? (
							<span className="shrink-0 whitespace-nowrap rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
								{t("lanes.composio.recommended")}
							</span>
						) : null}
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t("lanes.composio.body")}
					</p>
					<div className="flex flex-wrap items-center gap-1">
						{APP_TILES.map((tile) => (
							<AppIcon
								key={tile.slug}
								name={tile.name}
								composioSlug={tile.slug}
								size={18}
								className="rounded-md"
							/>
						))}
						<span className="ml-1 text-[10px] text-muted-foreground">
							{t("lanes.composio.moreApps")}
						</span>
					</div>
					{isWeb ? (
						<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
							{t("composio.webUnsupported")}
						</p>
					) : null}
					<Button
						type="button"
						size="sm"
						className="mt-auto w-full"
						disabled={isWeb}
						onClick={() => onSelect("composio")}
					>
						{t("lanes.composio.action")}
					</Button>
				</div>

				{/* Local server */}
				<div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-background/60 p-3.5">
					<div className="flex items-center gap-2">
						<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-700 to-cyan-400 text-white">
							<Terminal size={13} />
						</span>
						<span className="min-w-0 truncate text-sm font-semibold">
							{t("lanes.template.name")}
						</span>
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t("lanes.template.body")}
					</p>
					{canSpawnNatively ? (
						<p className="flex items-start gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-emerald-600 dark:text-emerald-400">
							<Check size={11} className="mt-px shrink-0" />
							{t("lanes.template.nativeNote")}
						</p>
					) : (
						<p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
							<AlertTriangle size={11} className="mt-px shrink-0" />
							{t("lanes.template.bridgeWarning")}
						</p>
					)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="mt-auto w-full"
						onClick={() => onSelect("template")}
					>
						{t("lanes.template.action")}
					</Button>
				</div>

				{/* Custom endpoint */}
				<div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-background/60 p-3.5">
					<div className="flex items-center gap-2">
						<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-slate-600 to-slate-400 text-white">
							<Link2 size={13} />
						</span>
						<span className="min-w-0 truncate text-sm font-semibold">
							{t("lanes.custom.name")}
						</span>
					</div>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t("lanes.custom.body")}
					</p>
					{/* A URL has no space to break at, so it needs permission to. */}
					<div className="break-all rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-muted-foreground">
						https://mcp.example.com/mcp
						<br />
						Authorization: Bearer ••••
					</div>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="mt-auto w-full"
						onClick={() => onSelect("custom")}
					>
						{t("lanes.custom.action")}
					</Button>
				</div>
			</div>

			{compact ? null : (
				<div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 px-3 py-2.5">
					<Shield size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{t("empty.encryption")}
					</p>
				</div>
			)}
		</div>
	);
};

export const AddConnectionButton: React.FC<{ onClick: () => void }> = ({
	onClick,
}) => {
	const { t } = useTranslation("connections");
	return (
		<Button type="button" size="sm" className="w-full" onClick={onClick}>
			<Plus size={13} className="mr-1.5" />
			{t("add")}
		</Button>
	);
};
