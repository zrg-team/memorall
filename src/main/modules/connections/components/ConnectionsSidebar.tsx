import React from "react";
import { useTranslation } from "react-i18next";
import { Link2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/main/stores/connections";
import type { McpConnection } from "@/services/mcp-connections";
import { StatusDot } from "./StatusPill";

/**
 * The list of credentials the user manages — not the list of tools they get.
 * Composio therefore occupies one row with its apps nested underneath, rather
 * than one row per connected SaaS app.
 */

const KindIcon: React.FC<{ connection: McpConnection }> = ({ connection }) => {
	if (connection.kind === "composio") {
		return (
			<span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-[10px] font-bold text-white">
				C
			</span>
		);
	}
	return (
		<span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
			{connection.kind === "template" ? (
				<Terminal size={12} />
			) : (
				<Link2 size={12} />
			)}
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
			<KindIcon connection={connection} />
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
