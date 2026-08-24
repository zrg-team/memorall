import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { GRAPH_REGISTRY, type GraphType } from "@/main/stores/agent-config";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { cn } from "@/lib/utils";
import type { GraphMeta } from "./types";

export const AdvancedGraphSection: React.FC<{
	currentGraphType: GraphType;
	currentGraphMeta: GraphMeta;
	showBaseGraph: boolean;
	setShowBaseGraph: React.Dispatch<React.SetStateAction<boolean>>;
	setGraphType: (graphType: GraphType) => void;
}> = ({
	currentGraphType,
	currentGraphMeta,
	showBaseGraph,
	setShowBaseGraph,
	setGraphType,
}) => {
	const { t } = useTranslation(["chat", "agents", "common"]);

	return (
		<div>
			<button
				type="button"
				onClick={() => setShowBaseGraph((value) => !value)}
				className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronDown
					size={13}
					className={cn(
						"transition-transform",
						showBaseGraph ? "rotate-180" : "",
					)}
				/>
				{t("advanced.label", { ns: "agents" })}
			</button>

			{showBaseGraph && (
				<div className="mt-3 space-y-3 rounded-2xl glass p-4 sm:p-5">
					<div className="space-y-1">
						<Label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
							{t("agentSettings.baseGraph")}
						</Label>
						<p className="text-sm font-semibold">
							{currentGraphMeta
								? t(currentGraphMeta.nameKey)
								: currentGraphType}
						</p>
					</div>
					<Select
						value={currentGraphType}
						onValueChange={(value) => setGraphType(value as GraphType)}
					>
						<SelectTrigger className="h-10 rounded-xl border-border/70 bg-background/80 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{GRAPH_REGISTRY.map((graph) => (
								<SelectItem key={graph.id} value={graph.id} className="text-xs">
									{t(graph.nameKey)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{currentGraphMeta ? (
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							{t(currentGraphMeta.descKey)}
						</p>
					) : null}
				</div>
			)}
		</div>
	);
};
