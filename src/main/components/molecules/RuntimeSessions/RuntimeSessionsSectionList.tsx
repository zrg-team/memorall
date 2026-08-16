import React from "react";
import { useTranslation } from "react-i18next";
import type {
	RuntimeSessionsSharedProps,
	RuntimeSessionsVariant,
} from "./types";
import { CommandCard } from "./CommandCard";
import { ServerCard } from "./ServerCard";
import { WebBrowserSessionCard } from "./WebBrowserSessionCard";
import { ManagedBrowserCard } from "./ManagedBrowserCard";
import { platform } from "@/platform/current";

export const RuntimeSessionsSectionList: React.FC<
	RuntimeSessionsSharedProps & {
		variant: RuntimeSessionsVariant;
	}
> = ({ commands, servers, activeWebSession, onRefresh, variant }) => {
	const { t } = useTranslation();
	const hasWebSession = Boolean(activeWebSession?.isOpen);

	return (
		<div className="space-y-3">
			{variant === "docked" && platform.browserAutomation ? (
				<div className="space-y-2">
					<div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
						{t("sandboxPanel.managedBrowserSection")}
					</div>
					<ManagedBrowserCard control={platform.browserAutomation} />
				</div>
			) : null}
			{hasWebSession ? (
				<div className="space-y-2">
					<div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
						{t("sandboxPanel.webSessionTitle")}
					</div>
					<WebBrowserSessionCard
						session={activeWebSession!}
						onChanged={onRefresh}
					/>
				</div>
			) : null}
			{commands.length > 0 ? (
				<div className="space-y-2">
					<div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
						{t("sandboxPanel.commandsTitle")}
					</div>
					{commands.map((command) => (
						<CommandCard
							key={command.commandId}
							command={command}
							onChanged={onRefresh}
						/>
					))}
				</div>
			) : null}
			{servers.length > 0 ? (
				<div className="space-y-2">
					<div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
						{t("sandboxPanel.serversTitle")}
					</div>
					{servers.map((server) => (
						<ServerCard
							key={server.port}
							server={server}
							onChanged={onRefresh}
							variant={variant}
						/>
					))}
				</div>
			) : null}
		</div>
	);
};
