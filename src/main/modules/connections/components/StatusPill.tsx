import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/main/stores/connections";

/**
 * One rendering of connection health, reused by the sidebar, the detail header
 * and the agent picker. Semantic colour only — the accent blue is reserved for
 * selection, so a blue dot never competes with a healthy green one.
 */

const STATUS_STYLES: Record<
	ConnectionStatus,
	{ dot: string; text: string; bg: string; border: string }
> = {
	connected: {
		dot: "bg-emerald-500",
		text: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-500/10",
		border: "border-emerald-500/30",
	},
	locked: {
		dot: "bg-blue-500",
		text: "text-blue-600 dark:text-blue-400",
		bg: "bg-blue-500/10",
		border: "border-blue-500/30",
	},
	"needs-auth": {
		dot: "bg-amber-500",
		text: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-500/10",
		border: "border-amber-500/30",
	},
	"bridge-down": {
		dot: "bg-amber-500",
		text: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-500/10",
		border: "border-amber-500/30",
	},
	error: {
		dot: "bg-destructive",
		text: "text-destructive",
		bg: "bg-destructive/10",
		border: "border-destructive/30",
	},
	off: {
		dot: "bg-muted-foreground/50",
		text: "text-muted-foreground",
		bg: "bg-muted/50",
		border: "border-border",
	},
	unknown: {
		dot: "bg-muted-foreground/50",
		text: "text-muted-foreground",
		bg: "bg-muted/50",
		border: "border-border",
	},
};

const STATUS_KEYS: Record<ConnectionStatus, string> = {
	connected: "status.connected",
	locked: "status.locked",
	"needs-auth": "status.needsAuth",
	"bridge-down": "status.bridgeDown",
	error: "status.error",
	off: "status.off",
	unknown: "status.off",
};

export const StatusDot: React.FC<{
	status: ConnectionStatus;
	className?: string;
}> = ({ status, className }) => (
	<span
		className={cn(
			"h-1.5 w-1.5 shrink-0 rounded-full",
			STATUS_STYLES[status].dot,
			className,
		)}
	/>
);

export const StatusPill: React.FC<{
	status: ConnectionStatus;
	className?: string;
}> = ({ status, className }) => {
	const { t } = useTranslation("connections");
	const style = STATUS_STYLES[status];

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
				style.bg,
				style.border,
				style.text,
				className,
			)}
		>
			<StatusDot status={status} />
			{t(STATUS_KEYS[status])}
		</span>
	);
};
