import NiceModal from "@ebay/nice-modal-react";
import {
	CalendarClock,
	FolderOpen,
	Globe,
	LayoutDashboard,
	ListChecks,
	Monitor,
	Plug,
	Settings2,
	Sparkles,
	SquareTerminal,
	WandSparkles,
} from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Switch } from "@/main/components/ui/switch";
import { AgentFeatureDetailModal } from "@/main/modules/agents/modals/AgentFeatureDetailModal";
import {
	type AgentFeatureDefinition,
	useAgentConfigStore,
} from "@/main/stores/agent-config";
import { platform } from "@/platform/current";
import {
	MEMON_APP_FEATURES,
	MEMON_APP_IDS,
	MEMON_BUILTIN_APPS,
	MEMON_STEP_NAME,
	type MemonAppId,
	type MemonBuiltinApp,
} from "@/services/memon/constants";
import {
	getAgentFeatureDescription,
	getAgentFeatureDisplayName,
} from "../utils/feature-display";

const APP_ICONS: Record<
	MemonAppId,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	browser: Globe,
	files: FolderOpen,
	terminal: SquareTerminal,
	notes: ListChecks,
	visualize: LayoutDashboard,
};

const BUILTIN_ICONS: Record<
	MemonBuiltinApp,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	scheduler: CalendarClock,
	studio: Sparkles,
	skills: WandSparkles,
	connections: Plug,
};

const isAvailableHere = (feature: AgentFeatureDefinition): boolean =>
	!feature.requiresCapability ||
	platform.capabilities.get(feature.requiresCapability).available;

/**
 * MemonOS Bot, set apart above the features: turning it on gives the agent a
 * computer and turns on the features that become its apps (Web Browser,
 * File System, Browser Sandbox, Planner). Those stay switchable in Features
 * below.
 */
export const MemonOSSection: React.FC = () => {
	const { t } = useTranslation("chat");
	const { featureDefinitions, draftFeatures, toggleFeature } =
		useAgentConfigStore();
	const memon = featureDefinitions.find(
		(feature) => feature.name === MEMON_STEP_NAME,
	);
	if (!memon) return null;

	const enabled = Boolean(draftFeatures[memon.name]);
	const appFeature = (app: MemonAppId) =>
		featureDefinitions.find(
			(feature) => feature.name === MEMON_APP_FEATURES[app],
		);

	const setEnabled = (next: boolean) => {
		if (next === enabled) return;
		toggleFeature(memon.name);
		if (!next) return;
		for (const app of MEMON_APP_IDS) {
			const feature = appFeature(app);
			if (
				feature &&
				isAvailableHere(feature) &&
				!useAgentConfigStore.getState().draftFeatures[feature.name]
			) {
				toggleFeature(feature.name);
			}
		}
	};

	return (
		<section
			className={cn(
				"rounded-2xl border p-4 transition-colors",
				enabled
					? "border-cyan-500/40 bg-[linear-gradient(135deg,rgba(8,145,178,0.12),transparent_60%)]"
					: "border-cyan-500/25 bg-cyan-500/[0.03]",
			)}
		>
			<div className="flex items-start gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
					<Monitor size={18} />
				</span>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center gap-1.5">
						<span
							className={cn(
								"h-1.5 w-1.5 shrink-0 rounded-full",
								enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
							)}
						/>
						<h3 className="text-sm font-semibold leading-tight">
							{getAgentFeatureDisplayName(memon, t)}
						</h3>
					</div>
					<p className="text-xs leading-snug text-muted-foreground">
						{getAgentFeatureDescription(memon, t)}
					</p>
					<p className="text-[11px] leading-snug text-muted-foreground">
						{t("agentSettings.memon.sectionHint")}
					</p>
				</div>
				<Switch
					checked={enabled}
					onCheckedChange={setEnabled}
					aria-label={getAgentFeatureDisplayName(memon, t)}
					className="shrink-0"
				/>
			</div>
			{enabled ? (
				<div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-cyan-500/20 pt-3">
					<span className="mr-1 text-[11px] font-medium text-muted-foreground">
						{t("agentSettings.memon.appsShort")}
					</span>
					{MEMON_APP_IDS.map((app) => {
						const feature = appFeature(app);
						if (!feature) return null;
						const Icon = APP_ICONS[app];
						const on = Boolean(draftFeatures[feature.name]);
						const available = isAvailableHere(feature);
						return (
							<button
								type="button"
								key={app}
								disabled={!available}
								aria-pressed={on}
								onClick={() => toggleFeature(feature.name)}
								title={getAgentFeatureDisplayName(feature, t)}
								className={cn(
									"inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors disabled:opacity-50",
									on
										? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
										: "border-border/60 text-muted-foreground line-through hover:bg-muted",
								)}
							>
								<Icon size={12} />
								{t(`agentSettings.memon.apps.${app}.name`)}
							</button>
						);
					})}
					<span
						className="ml-1 text-[11px] text-muted-foreground"
						title={t("agentSettings.memon.builtInHint")}
					>
						{t("agentSettings.memon.builtIn")}
					</span>
					{MEMON_BUILTIN_APPS.map((app) => {
						const Icon = BUILTIN_ICONS[app];
						return (
							<span
								key={app}
								className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-cyan-500/25 px-2 text-[11px] text-cyan-700/90 dark:text-cyan-300/90"
							>
								<Icon size={12} />
								{t(`agentSettings.memon.builtInApps.${app}`)}
							</span>
						);
					})}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="ml-auto h-7 rounded-lg px-2 text-[11px]"
						onClick={() =>
							void NiceModal.show(AgentFeatureDetailModal, {
								featureName: memon.name,
							})
						}
					>
						<Settings2 size={12} />
						{t("agentSettings.memon.settings")}
					</Button>
				</div>
			) : null}
		</section>
	);
};
