import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertCircle,
	ArrowRight,
	Loader2,
	Pencil,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/main/stores/connections";
import {
	findAgentsUsingConnection,
	toServerKey,
	type ConnectionUsage,
	type McpConnection,
} from "@/services/mcp-connections";
import { StatusPill } from "./StatusPill";
import { ToolScopeList } from "./ToolScopeList";
import { CustomEndpointForm } from "./CustomEndpointForm";

type DetailTab = "tools" | "usedBy" | "settings";

const relativeTime = (iso: string): string => {
	const delta = Date.now() - new Date(iso).getTime();
	const minutes = Math.round(delta / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
};

export const ConnectionDetail: React.FC<{
	connection: McpConnection;
	/** Reopen the lane that created this connection, for unfinished setup. */
	onContinueSetup?: () => void;
}> = ({ connection, onContinueSetup }) => {
	const { t } = useTranslation("connections");
	const [tab, setTab] = React.useState<DetailTab>("tools");
	const [isEditing, setIsEditing] = React.useState(false);
	const [usage, setUsage] = React.useState<ConnectionUsage[] | null>(null);

	const status = useConnectionsStore((state) => state.statusOf(connection.id));
	const tools = useConnectionsStore((state) => state.toolsOf(connection.id));
	const cacheEntry = useConnectionsStore(
		(state) => state.toolCache[connection.id],
	);
	const discovering = useConnectionsStore((state) =>
		state.discovering.includes(connection.id),
	);
	const discover = useConnectionsStore((state) => state.discover);
	const save = useConnectionsStore((state) => state.save);
	const remove = useConnectionsStore((state) => state.remove);

	React.useEffect(() => {
		setTab("tools");
		setIsEditing(false);
		setUsage(null);
	}, [connection.id]);

	React.useEffect(() => {
		if (tab !== "usedBy" || usage !== null) return;
		let active = true;
		void findAgentsUsingConnection(connection.id).then((result) => {
			if (active) setUsage(result);
		});
		return () => {
			active = false;
		};
	}, [tab, usage, connection.id]);

	const handleDelete = async () => {
		if (!confirm(t("detail.deleteConfirm"))) return;
		await remove(connection.id);
	};

	if (isEditing) {
		return (
			<div className="p-4">
				<CustomEndpointForm
					connection={connection}
					onSaved={() => setIsEditing(false)}
					onCancel={() => setIsEditing(false)}
				/>
			</div>
		);
	}

	/**
	 * Setup that never produced an endpoint has nothing to sync, list or scope.
	 * Showing the usual tabs here strands the user on "not synced yet" with no
	 * way forward, so this replaces them with the one action that matters.
	 */
	if (status === "incomplete") {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
					<h2 className="truncate text-sm font-semibold">{connection.name}</h2>
					<div className="flex shrink-0 items-center gap-1.5">
						<StatusPill status={status} />
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 w-7 rounded-lg p-0 text-destructive hover:text-destructive"
							onClick={() => void handleDelete()}
							aria-label={t("detail.delete")}
						>
							<Trash2 size={11} />
						</Button>
					</div>
				</div>

				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
					<p className="max-w-sm text-sm text-muted-foreground">
						{t("status.incompleteHint")}
					</p>
					{onContinueSetup ? (
						<Button type="button" size="sm" onClick={onContinueSetup}>
							<ArrowRight size={13} className="mr-1.5" />
							{t("status.continueSetup")}
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h2 className="truncate text-sm font-semibold">
								{connection.name}
							</h2>
							<Badge variant="outline" className="text-[9px] uppercase">
								{connection.transport}
							</Badge>
						</div>
						<p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
							{connection.url}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<StatusPill status={status} />
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 rounded-lg px-2 text-[10px]"
						disabled={discovering}
						onClick={() => void discover(connection.id)}
					>
						{discovering ? (
							<Loader2 size={10} className="mr-1 animate-spin" />
						) : (
							<RefreshCw size={10} className="mr-1" />
						)}
						{t("detail.test")}
					</Button>
					{connection.kind !== "composio" ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-7 w-7 rounded-lg p-0"
							onClick={() => setIsEditing(true)}
							aria-label={t("detail.tabs.settings")}
						>
							<Pencil size={11} />
						</Button>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 w-7 rounded-lg p-0 text-destructive hover:text-destructive"
						onClick={() => void handleDelete()}
						aria-label={t("detail.delete")}
					>
						<Trash2 size={11} />
					</Button>
				</div>
			</div>

			{cacheEntry?.error ? (
				<div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2">
					<AlertCircle size={12} className="mt-0.5 shrink-0 text-destructive" />
					<p className="min-w-0 break-words text-[11px] text-destructive">
						{status === "bridge-down"
							? t("status.bridgeDownHint")
							: cacheEntry.error}
					</p>
				</div>
			) : null}

			<div className="flex gap-1 border-b border-border/60 px-4">
				{(["tools", "usedBy", "settings"] as const).map((candidate) => (
					<button
						key={candidate}
						type="button"
						onClick={() => setTab(candidate)}
						className={cn(
							"-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors",
							tab === candidate
								? "border-blue-500 text-blue-500"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{t(`detail.tabs.${candidate}`)}
					</button>
				))}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{tab === "tools" ? (
					tools.length > 0 ? (
						<div className="space-y-2.5">
							<div className="flex items-center justify-between text-[11px] text-muted-foreground">
								<span>{t("detail.toolCount", { count: tools.length })}</span>
								<span>
									{cacheEntry?.discoveredAt
										? t("detail.syncedAt", {
												when: relativeTime(cacheEntry.discoveredAt),
											})
										: t("detail.neverSynced")}
								</span>
							</div>
							<ToolScopeList
								tools={tools}
								value={connection.toolAllowlist ?? []}
								onChange={(next) =>
									void save({
										...connection,
										toolAllowlist: next.length > 0 ? next : undefined,
									})
								}
							/>
						</div>
					) : (
						<p className="py-8 text-center text-xs text-muted-foreground">
							{status === "locked"
								? t("status.lockedHint")
								: t("detail.neverSynced")}
						</p>
					)
				) : null}

				{tab === "usedBy" ? (
					usage === null ? (
						<div className="flex justify-center py-8">
							<Loader2
								size={16}
								className="animate-spin text-muted-foreground"
							/>
						</div>
					) : usage.length === 0 ? (
						<p className="py-8 text-center text-xs text-muted-foreground">
							{t("detail.usedByNone")}
						</p>
					) : (
						<div className="space-y-1.5">
							{usage.map((agent) => (
								<div
									key={agent.flowId}
									className="rounded-lg border border-border/60 px-3 py-2 text-xs font-medium"
								>
									{agent.name}
								</div>
							))}
						</div>
					)
				) : null}

				{tab === "settings" ? (
					<dl className="space-y-2.5 text-xs">
						<div className="flex items-start justify-between gap-4">
							<dt className="text-muted-foreground">
								{t("custom.namePrefixHint", {
									prefix: toServerKey(connection),
								})}
							</dt>
						</div>
						<div className="flex items-start justify-between gap-4">
							<dt className="text-muted-foreground">{t("custom.authLabel")}</dt>
							<dd className="font-medium">{connection.authMode}</dd>
						</div>
						<div className="flex items-start justify-between gap-4">
							<dt className="text-muted-foreground">
								{t("custom.enableByDefault")}
							</dt>
							<dd className="font-medium">
								{connection.enabledByDefault ? "Yes" : "No"}
							</dd>
						</div>
					</dl>
				) : null}
			</div>
		</div>
	);
};
