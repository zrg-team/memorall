import React from "react";
import { RefreshCw, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/main/components/ui/card";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { platform } from "@/platform/current";
import type {
	RuntimeServiceName,
	RuntimeServiceStatus,
} from "@/platform/contracts/core";

type ServiceStatus = RuntimeServiceStatus;

interface ServiceStatuses {
	webllm: ServiceStatus;
	wllama: ServiceStatus;
	transformer: ServiceStatus;
}

const SERVICES = ["webllm", "wllama", "transformer"] as const;

const DEFAULT_STATUSES: ServiceStatuses = {
	webllm: { registered: false, ready: false },
	wllama: { registered: false, ready: false },
	transformer: { registered: false, ready: false },
};

function StatusBadge({
	status,
	t,
}: {
	status: ServiceStatus;
	t: (key: string) => string;
}) {
	if (status.ready) {
		return (
			<Badge
				variant="secondary"
				className="bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400"
			>
				{t("offscreenServices.status.ready")}
			</Badge>
		);
	}
	if (status.registered) {
		return (
			<Badge
				variant="secondary"
				className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:text-yellow-400"
			>
				{t("offscreenServices.status.loading")}
			</Badge>
		);
	}
	return (
		<Badge variant="outline" className="text-muted-foreground">
			{t("offscreenServices.status.idle")}
		</Badge>
	);
}

export function OffscreenServicesCard() {
	const { t } = useTranslation("llm");
	const [statuses, setStatuses] =
		React.useState<ServiceStatuses>(DEFAULT_STATUSES);
	const [resetting, setResetting] = React.useState<string | null>(null);
	const [offscreenAlive, setOffscreenAlive] = React.useState<boolean | null>(
		null,
	);

	const fetchStatus = React.useCallback(async () => {
		try {
			const snapshot = await platform.runtimeDiagnostics.status();
			setOffscreenAlive(snapshot.alive);
			setStatuses(snapshot.statuses);
		} catch {
			setOffscreenAlive(false);
			setStatuses(DEFAULT_STATUSES);
		}
	}, []);

	React.useEffect(() => {
		void fetchStatus();
		const interval = setInterval(() => void fetchStatus(), 5000);
		return () => clearInterval(interval);
	}, [fetchStatus]);

	const handleReset = React.useCallback(
		async (serviceName: RuntimeServiceName) => {
			setResetting(serviceName);
			try {
				await platform.runtimeDiagnostics.reset(serviceName);
				await fetchStatus();
			} catch {
				// ignore
			} finally {
				setResetting(null);
			}
		},
		[fetchStatus],
	);

	return (
		<Card className="rounded-none md:rounded-lg">
			<CardHeader className="p-3 pb-0">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Cpu className="h-4 w-4 text-muted-foreground" />
						<CardTitle className="text-lg">
							{t("offscreenServices.title")}
						</CardTitle>
					</div>
					<div className="flex items-center gap-2">
						{offscreenAlive === true && (
							<Badge
								variant="secondary"
								className="bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400 text-xs"
							>
								{t("offscreenServices.running")}
							</Badge>
						)}
						{offscreenAlive === false && (
							<Badge
								variant="outline"
								className="text-muted-foreground text-xs"
							>
								{t("offscreenServices.offline")}
							</Badge>
						)}
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6"
							onClick={() => void fetchStatus()}
							title={t("offscreenServices.refreshStatus")}
						>
							<RefreshCw className="h-3 w-3" />
						</Button>
					</div>
				</div>
				<CardDescription>{t("offscreenServices.description")}</CardDescription>
			</CardHeader>
			<CardContent className="p-3">
				<div className="space-y-2">
					{SERVICES.map((name) => (
						<div
							key={name}
							className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-2"
						>
							<div className="min-w-0">
								<div className="text-sm font-medium leading-none">
									{t(`offscreenServices.services.${name}.label`)}
								</div>
								<div className="mt-0.5 text-xs text-muted-foreground">
									{t(`offscreenServices.services.${name}.description`)}
								</div>
							</div>
							<div className="ml-3 flex shrink-0 items-center gap-2">
								<StatusBadge status={statuses[name]} t={t} />
								<Button
									variant="outline"
									size="sm"
									className="h-7 px-2 text-xs"
									disabled={resetting !== null || offscreenAlive === false}
									onClick={() => void handleReset(name)}
								>
									<RefreshCw
										className={`mr-1 h-3 w-3 ${resetting === name ? "animate-spin" : ""}`}
									/>
									{t("offscreenServices.reset")}
								</Button>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
