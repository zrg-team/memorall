import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Construction, Loader2, Plug } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { PageHeader } from "@/main/components/ui/page-header";
import { useConnectionsStore } from "@/main/stores/connections";
import {
	AddConnectionButton,
	AddConnectionChooser,
	ComposioWizard,
	ConnectionDetail,
	ConnectionsSidebar,
	CustomEndpointForm,
	type ConnectionLane,
} from "@/main/modules/connections";

/**
 * Sidebar of connections plus a detail pane, matching the Models and Agents
 * workspace views. The chooser doubles as the empty state and as the "add"
 * screen, so there is one place that explains the three ways in.
 */
export const ConnectionsPage: React.FC = () => {
	const { t } = useTranslation("connections");
	const connections = useConnectionsStore((state) => state.connections);
	const selectedId = useConnectionsStore((state) => state.selectedId);
	const isLoading = useConnectionsStore((state) => state.isLoading);
	const initialize = useConnectionsStore((state) => state.initialize);
	const discoverAll = useConnectionsStore((state) => state.discoverAll);
	const select = useConnectionsStore((state) => state.select);
	const connectedCount = useConnectionsStore((state) => state.connectedCount());
	const totalTools = useConnectionsStore((state) => state.totalToolCount());

	const [lane, setLane] = React.useState<ConnectionLane | null>(null);

	React.useEffect(() => {
		void initialize().then(() => void discoverAll());
	}, [initialize, discoverAll]);

	const selected = connections.find(
		(connection) => connection.id === selectedId,
	);
	const isEmpty = connections.length === 0;

	const startAdding = (nextLane: ConnectionLane) => {
		setLane(nextLane);
		select(null);
	};

	const renderMain = () => {
		if (isLoading && isEmpty) {
			return (
				<div className="flex flex-1 items-center justify-center">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			);
		}

		if (lane === "custom") {
			return (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="mb-3 flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={() => setLane(null)}
							aria-label={t("composio.cancel")}
						>
							<ArrowLeft size={14} />
						</Button>
						<div>
							<h2 className="text-sm font-semibold">{t("custom.title")}</h2>
							<p className="text-[11px] text-muted-foreground">
								{t("custom.subtitle")}
							</p>
						</div>
					</div>
					<CustomEndpointForm
						onSaved={() => setLane(null)}
						onCancel={() => setLane(null)}
					/>
				</div>
			);
		}

		if (lane === "composio") {
			return (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="mx-auto max-w-2xl">
						<ComposioWizard
							onDone={() => setLane(null)}
							onCancel={() => setLane(null)}
						/>
					</div>
				</div>
			);
		}

		// The local-server lane has not been built yet. Say so plainly and point
		// at the lane that does work, rather than showing a dead end.
		if (lane === "template") {
			return (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
					<Construction size={22} className="text-muted-foreground" />
					<div>
						<p className="text-sm font-semibold">
							{t("lanes.template.notBuiltTitle")}
						</p>
						<p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
							{t("lanes.template.notBuiltBody")}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setLane(null)}
						>
							<ArrowLeft size={13} className="mr-1.5" />
							{t("composio.cancel")}
						</Button>
						<Button type="button" size="sm" onClick={() => setLane("custom")}>
							{t("lanes.custom.action")}
						</Button>
					</div>
				</div>
			);
		}

		if (selected) {
			return <ConnectionDetail connection={selected} />;
		}

		return (
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				<div className="mx-auto max-w-3xl space-y-4">
					<div>
						<h2 className="text-base font-semibold">{t("empty.title")}</h2>
						<p className="mt-1 max-w-xl text-sm text-muted-foreground">
							{t("empty.body")}
						</p>
					</div>
					<AddConnectionChooser onSelect={startAdding} />
				</div>
			</div>
		);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[264px_1fr]">
				<aside className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
					<PageHeader
						icon={<Plug size={18} />}
						title={t("title")}
						description={
							isEmpty
								? t("descriptionEmpty")
								: t("description", {
										connected: connectedCount,
										tools: totalTools,
									})
						}
					/>
					<div className="px-2 pt-2">
						<AddConnectionButton onClick={() => startAdding("custom")} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<ConnectionsSidebar
							onSelect={(id) => {
								setLane(null);
								select(id);
							}}
						/>
					</div>
				</aside>

				<main className="flex min-h-0 flex-col overflow-hidden">
					{renderMain()}
				</main>
			</div>
		</div>
	);
};
