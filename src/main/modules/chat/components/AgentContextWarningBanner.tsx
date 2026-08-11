import React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { AlertTriangle, Gauge, MessageSquare } from "lucide-react";
import { serviceManager } from "@/services";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import type { FeatureCatalogMetadata } from "@/services/flow-feature-catalog-service";
import { logError } from "@/utils/logger";

const LOCAL_BROWSER_PROVIDERS = new Set<ServiceProvider>([
	"wllama",
	"webllm",
	"transformer",
]);
const HEAVY_FLOW_RATIO = 0.3;
const ESTIMATED_TOOL_DEFINITION_TOKENS = 220;

type CurrentModel = {
	modelId: string;
	provider: ServiceProvider;
} | null;

interface AgentContextWarningBannerProps {
	current: CurrentModel;
	selectedAgentFlowId: string | null;
	selectedAgentName?: string;
	onUseChatMode: () => void;
}

interface FlowEstimate {
	estimatedTokens: number;
	maxTokens: number | null;
	ratio: number | null;
}

function estimateTokens(value: unknown): number {
	if (value == null) return 0;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return Math.ceil(text.length / 4);
}

function addToolNamesFromValue(value: unknown, toolNames: Set<string>): void {
	if (!Array.isArray(value)) return;
	for (const tool of value) {
		if (typeof tool === "string") {
			toolNames.add(tool);
			continue;
		}
		if (tool && typeof tool === "object" && "name" in tool) {
			const name = (tool as { name?: unknown }).name;
			if (typeof name === "string") toolNames.add(name);
		}
	}
}

function estimateToolDefinitionTokens(toolNames: Set<string>): number {
	return Array.from(toolNames).reduce(
		(total, name) =>
			total + ESTIMATED_TOOL_DEFINITION_TOKENS + estimateTokens(name),
		0,
	);
}

function collectConfigPromptTokens(
	config: UnifiedFlowConfig,
	toolNames: Set<string>,
): number {
	return config.steps
		.filter((step) => step.enabled)
		.reduce((total, step) => {
			const stepConfig = step.config ?? {};
			const configTokens = Object.entries(stepConfig).reduce(
				(sum, [key, value]) => {
					const lowerKey = key.toLowerCase();
					if (lowerKey.includes("tools")) {
						addToolNamesFromValue(value, toolNames);
					}
					if (
						lowerKey.includes("prompt") ||
						lowerKey.includes("content") ||
						lowerKey.includes("instruction")
					) {
						return sum + estimateTokens(value);
					}
					return sum;
				},
				0,
			);
			return total + configTokens;
		}, 0);
}

function collectCatalogPromptTokens(
	config: UnifiedFlowConfig,
	catalogFeatures: Map<string, FeatureCatalogMetadata>,
	toolNames: Set<string>,
): number {
	return config.steps
		.filter((step) => step.enabled)
		.reduce((total, step) => {
			const metadata = catalogFeatures.get(step.name);
			if (!metadata) return total;
			addToolNamesFromValue(metadata.tools, toolNames);
			return total + estimateTokens(metadata.systemPrompt);
		}, 0);
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return value.toLocaleString();
}

export const AgentContextWarningBanner: React.FC<
	AgentContextWarningBannerProps
> = ({ current, selectedAgentFlowId, selectedAgentName, onUseChatMode }) => {
	const { t } = useTranslation("chat");
	const [estimate, setEstimate] = React.useState<FlowEstimate | null>(null);
	const isAgentMode = Boolean(
		selectedAgentFlowId && selectedAgentFlowId !== "chat",
	);
	const isLocalBrowserProvider = Boolean(
		current && LOCAL_BROWSER_PROVIDERS.has(current.provider),
	);

	React.useEffect(() => {
		let cancelled = false;

		const loadEstimate = async () => {
			if (!isAgentMode || !selectedAgentFlowId || !current) {
				setEstimate(null);
				return;
			}

			try {
				const [config, catalog, maxTokens] = await Promise.all([
					serviceManager.flowBuilderService.getUnifiedFlowConfig({
						flowId: selectedAgentFlowId,
					}),
					Promise.resolve(serviceManager.flowBuilderService.getCatalog()),
					serviceManager.llmService
						.getMaxModelTokensFor(
							PROVIDER_TO_SERVICE[current.provider],
							current.modelId,
						)
						.catch(() => null),
				]);

				if (cancelled) return;

				const catalogFeatures = new Map(
					catalog.steps
						.filter((step) => step.type === "feature")
						.map((step) => [
							step.name,
							step.metadata as FeatureCatalogMetadata,
						]),
				);
				const toolNames = new Set<string>();
				const estimatedTokens =
					collectConfigPromptTokens(config, toolNames) +
					collectCatalogPromptTokens(config, catalogFeatures, toolNames) +
					estimateToolDefinitionTokens(toolNames);
				const validMaxTokens =
					typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : null;

				setEstimate({
					estimatedTokens,
					maxTokens: validMaxTokens,
					ratio: validMaxTokens ? estimatedTokens / validMaxTokens : null,
				});
			} catch (error) {
				if (!cancelled) {
					logError("Failed to estimate selected agent context:", error);
					setEstimate(null);
				}
			}
		};

		void loadEstimate();
		return () => {
			cancelled = true;
		};
	}, [current, isAgentMode, selectedAgentFlowId]);

	const isHeavyFlow = Boolean(
		estimate?.ratio != null && estimate.ratio > HEAVY_FLOW_RATIO,
	);

	if (!isAgentMode || (!isLocalBrowserProvider && !isHeavyFlow)) {
		return null;
	}

	const severityClass = isHeavyFlow
		? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-100"
		: "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-100";
	const mutedTextClass = isHeavyFlow
		? "text-amber-700/80 dark:text-amber-100/80"
		: "text-sky-700/80 dark:text-sky-100/80";
	const Icon = isHeavyFlow ? AlertTriangle : Gauge;

	return (
		<div className="relative z-30 w-full flex-shrink-0 px-4">
			<div className="mx-auto max-w-4xl">
				<div
					className={`relative z-30 mx-5 -mb-px flex items-center justify-between gap-3 rounded-lg rounded-bl-none rounded-br-none border px-3 py-2 ${severityClass}`}
				>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
							<Icon className="h-3.5 w-3.5 shrink-0" />
							<span>
								{isHeavyFlow
									? t("agentContextWarning.heavyTitle")
									: t("agentContextWarning.localTitle")}
							</span>
							{selectedAgentName ? (
								<Badge variant="outline" className="h-5 max-w-[180px] truncate">
									{selectedAgentName}
								</Badge>
							) : null}
							{current?.provider ? (
								<Badge variant="outline" className="h-5">
									{current.provider}
								</Badge>
							) : null}
						</div>
						<div className={`mt-0.5 text-xs ${mutedTextClass}`}>
							{isHeavyFlow && estimate?.maxTokens ? (
								<span>
									{t("agentContextWarning.heavyDescription", {
										used: formatTokens(estimate.estimatedTokens),
										max: formatTokens(estimate.maxTokens),
										percent: Math.round((estimate.ratio ?? 0) * 100),
									})}
								</span>
							) : null}
							{isLocalBrowserProvider ? (
								<span className={isHeavyFlow ? "ml-1" : undefined}>
									{t("agentContextWarning.localDescription")}
								</span>
							) : null}
						</div>
					</div>
					{isLocalBrowserProvider ? (
						<Button
							type="button"
							size="sm"
							onClick={onUseChatMode}
							className="h-8 shrink-0 border border-sky-300 bg-sky-50 px-3 text-sky-950 hover:bg-sky-100 dark:border-sky-300/40 dark:bg-sky-100 dark:text-sky-950 dark:hover:bg-sky-200"
						>
							<MessageSquare className="h-4 w-4" />
							{t("agentContextWarning.useChat")}
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
};
