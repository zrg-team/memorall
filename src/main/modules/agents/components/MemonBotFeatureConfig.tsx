import {
	FolderOpen,
	Globe,
	LayoutDashboard,
	ListChecks,
	Pi,
	SquareTerminal,
} from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/main/components/ui/badge";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { Switch } from "@/main/components/ui/switch";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { platform } from "@/platform/current";
import {
	MEMON_APP_FEATURES,
	MEMON_STEP_NAME,
	type MemonAppId,
} from "@/services/memon/constants";
import {
	type MemonFeatureConfig,
	normalizeMemonFeatureConfig,
} from "@/services/memon/feature-config";

const APPS: Array<{
	id: MemonAppId;
	icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
	{ id: "browser", icon: Globe },
	{ id: "files", icon: FolderOpen },
	{ id: "terminal", icon: SquareTerminal },
	{ id: "tasks", icon: ListChecks },
	{ id: "visualize", icon: LayoutDashboard },
];

const ASK_BEFORE: Array<keyof MemonFeatureConfig["askBefore"]> = [
	"forms",
	"installs",
	"deletes",
];

/** Why an app cannot run on this platform, if it cannot. */
const unavailableReasonKey = (app: MemonAppId): string | null => {
	if (app === "browser" && platform.environment === "web") {
		return "agentSettings.memon.browserUnavailableWeb";
	}
	return null;
};

/**
 * MemonOS Bot settings: when the computer opens and what the agent must ask
 * before doing, stored on the memon-feature step config. The apps follow the
 * Web Browser, File System, Browser Sandbox and Planner features, so they are shown
 * here but switched in Features.
 */
export const MemonBotFeatureConfig: React.FC = () => {
	const { t } = useTranslation("chat");
	const { savedUnifiedConfig, patchStepConfig, draftFeatures } =
		useAgentConfigStore();
	const config = normalizeMemonFeatureConfig(
		savedUnifiedConfig?.steps.find((step) => step.name === MEMON_STEP_NAME)
			?.config,
	);

	const patch = (next: Partial<MemonFeatureConfig>) =>
		patchStepConfig(MEMON_STEP_NAME, { ...config, ...next });

	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<Label className="text-xs font-medium">
					{t("agentSettings.memon.appsLabel")}
				</Label>
				<p className="text-[11px] leading-snug text-muted-foreground">
					{t("agentSettings.memon.appsHint")}
				</p>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{APPS.map(({ id, icon: Icon }) => {
						const reasonKey = unavailableReasonKey(id);
						const on = Boolean(draftFeatures[MEMON_APP_FEATURES[id]]);
						return (
							<div
								key={id}
								className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5"
							>
								<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
									<Icon size={14} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium">
										{t(`agentSettings.memon.apps.${id}.name`)}
									</span>
									<span className="block text-[11px] leading-snug text-muted-foreground">
										{reasonKey
											? t(reasonKey)
											: t(`agentSettings.memon.apps.${id}.description`)}
									</span>
								</span>
								<Badge
									variant={on ? "secondary" : "outline"}
									className={cn(
										"shrink-0 text-[10px]",
										on
											? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
											: "text-muted-foreground",
									)}
								>
									{on
										? t("agentSettings.memon.appOn")
										: t("agentSettings.memon.appOff")}
								</Badge>
							</div>
						);
					})}
				</div>
			</div>

			<div className="space-y-2">
				<Label className="text-xs font-medium">
					{t("agentSettings.memon.showComputerLabel")}
				</Label>
				<Select
					value={config.showComputer}
					onValueChange={(value) =>
						patch({ showComputer: value === "manual" ? "manual" : "auto" })
					}
				>
					<SelectTrigger className="h-9">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">
							{t("agentSettings.memon.showComputerAuto")}
						</SelectItem>
						<SelectItem value="manual">
							{t("agentSettings.memon.showComputerManual")}
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-2">
				<Label className="text-xs font-medium">
					{t("agentSettings.memon.askBeforeLabel")}
				</Label>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{ASK_BEFORE.map((gate) => (
						<div
							key={gate}
							className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5"
						>
							<span className="text-sm">
								{t(`agentSettings.memon.askBefore.${gate}`)}
							</span>
							<Switch
								checked={config.askBefore[gate]}
								onCheckedChange={(checked) =>
									patch({ askBefore: { ...config.askBefore, [gate]: checked } })
								}
								aria-label={t(`agentSettings.memon.askBefore.${gate}`)}
							/>
						</div>
					))}
				</div>
			</div>

			<div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
				<span className="flex min-w-0 items-start gap-3">
					<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lime-500/15 text-lime-700 dark:text-lime-300">
						<Pi size={14} />
					</span>
					<span className="min-w-0">
						<span className="block text-sm font-medium">
							{t("agentSettings.memon.piCode")}
						</span>
						<span className="block text-[11px] leading-snug text-muted-foreground">
							{t("agentSettings.memon.piCodeHint")}
						</span>
					</span>
				</span>
				<Switch
					checked={config.piCode}
					onCheckedChange={(checked) => patch({ piCode: checked })}
					aria-label={t("agentSettings.memon.piCode")}
				/>
			</div>

			<div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
				<span className="min-w-0">
					<span className="block text-sm font-medium">
						{t("agentSettings.memon.keepDirectTools")}
					</span>
					<span className="block text-[11px] leading-snug text-muted-foreground">
						{t("agentSettings.memon.keepDirectToolsHint")}
					</span>
				</span>
				<Switch
					checked={config.keepDirectTools}
					onCheckedChange={(checked) => patch({ keepDirectTools: checked })}
					aria-label={t("agentSettings.memon.keepDirectTools")}
				/>
			</div>
		</div>
	);
};
