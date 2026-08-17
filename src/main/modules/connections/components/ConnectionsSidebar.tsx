import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/main/stores/connections";
import type { McpConnection } from "@/services/mcp-connections";
import { AppIcon, ConnectionIcon } from "./AppIcon";
import { StatusDot } from "./StatusPill";

/**
 * The list of credentials the user manages — not the list of tools they get.
 * Composio therefore occupies one row with its apps nested underneath, rather
 * than one row per connected SaaS app.
 */

/** How many app marks fit beside a row before the rest become "+n". */
const STACK_LIMIT = 4;

/**
 * A credential's mark, with the apps it holds stacked over it.
 *
 * The row already names the apps in its subtitle, but overlapped marks say
 * "Gmail, Slack and GitHub live in here" at a glance, which is the actual
 * question someone scanning this list is asking.
 */
const RowIcon: React.FC<{ connection: McpConnection }> = ({ connection }) => {
	const apps = connection.kind === "composio" ? (connection.apps ?? []) : [];
	if (apps.length === 0) return <ConnectionIcon kind={connection.kind} />;

	const shown = apps.slice(0, STACK_LIMIT);
	return (
		<span className="flex shrink-0 items-center -space-x-1.5">
			{shown.map((app) => (
				<AppIcon
					key={app.id}
					name={app.name || app.id}
					src={app.logo}
					composioSlug={app.id}
					size={22}
					className="ring-1 ring-background"
				/>
			))}
			{apps.length > shown.length ? (
				<span className="grid h-[22px] shrink-0 place-items-center rounded-lg bg-muted px-1 text-[9px] font-semibold text-muted-foreground ring-1 ring-background">
					+{apps.length - shown.length}
				</span>
			) : null}
		</span>
	);
};

const ConnectionRow: React.FC<{
	connection: McpConnection;
	selected: boolean;
	onSelect: () => void;
}> = ({ connection, selected, onSelect }) => {
	const { t } = useTranslation("connections");
	const status = useConnectionsStore((state) => state.statusOf(connection.id));
	const tools = useConnectionsStore((state) => state.toolsOf(connection.id));

	const subtitle =
		status === "bridge-down"
			? t("status.bridgeDown")
			: status === "locked"
				? t("status.locked")
				: connection.kind === "composio"
					? (connection.apps ?? [])
							.map((app) => app.name)
							.slice(0, 3)
							.join(", ") || t("detail.toolCount", { count: tools.length })
					: connection.url.replace(/^https?:\/\//, "");

	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
				selected
					? "border-blue-500/30 bg-blue-500/10"
					: "border-transparent hover:bg-muted/60",
			)}
		>
			<RowIcon connection={connection} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-xs font-medium">{connection.name}</span>
				<span
					className={cn(
						"truncate text-[10px]",
						status === "bridge-down" || status === "needs-auth"
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground",
					)}
				>
					{subtitle}
				</span>
			</span>
			<StatusDot status={status} />
		</button>
	);
};

interface ConnectionsSidebarProps {
	onSelect: (id: string) => void;
	className?: string;
}

export const ConnectionsSidebar: React.FC<ConnectionsSidebarProps> = ({
	onSelect,
	className,
}) => {
	const { t } = useTranslation("connections");
	const connections = useConnectionsStore((state) => state.connections);
	const selectedId = useConnectionsStore((state) => state.selectedId);

	const composio = connections.filter(
		(connection) => connection.kind === "composio",
	);
	const servers = connections.filter(
		(connection) => connection.kind !== "composio",
	);

	// The page header already says there is nothing here; repeating it directly
	// underneath just reads as a rendering bug.
	if (connections.length === 0) {
		return null;
	}

	return (
		<div className={cn("flex flex-col gap-1 p-2", className)}>
			{composio.length > 0 ? (
				<>
					<div className="px-1.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
						{t("groups.composio")}
					</div>
					{composio.map((connection) => (
						<ConnectionRow
							key={connection.id}
							connection={connection}
							selected={connection.id === selectedId}
							onSelect={() => onSelect(connection.id)}
						/>
					))}
				</>
			) : null}

			{servers.length > 0 ? (
				<>
					<div className="px-1.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
						{t("groups.servers")}
					</div>
					{servers.map((connection) => (
						<ConnectionRow
							key={connection.id}
							connection={connection}
							selected={connection.id === selectedId}
							onSelect={() => onSelect(connection.id)}
						/>
					))}
				</>
			) : null}
		</div>
	);
};
