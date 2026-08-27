import React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { getProviderSupport } from "../utils/browser-support";

export type ProviderStatus = "active" | "configured" | "idle";

const PROVIDER_ORDER: ServiceProvider[] = [
	"transformer",
	"wllama",
	"webllm",
	"openai",
	"openrouter",
	"lmstudio",
	"ollama",
];

interface ProviderTabsProps {
	advancedProvider: ServiceProvider;
	setAdvancedProvider: (provider: ServiceProvider) => void;
	loading: boolean;
	onProviderChange: () => void;
	onWebLLMTabSelect: (webllmAvailableModels: string[]) => void;
	webllmAvailableModels: string[];
	onOpenAITabSelect: () => void;
	providerStatuses?: Record<ServiceProvider, ProviderStatus>;
	/**
	 * Rendered at the head of the strip, before a divider. Used to host the
	 * "Recommended" mode switch so it does not need a second full-width bar
	 * stacked above this one — two identical strips read as two tab rows and
	 * gave no clue which one was the mode and which the provider.
	 */
	leading?: React.ReactNode;
}

export const ProviderTabs: React.FC<ProviderTabsProps> = ({
	advancedProvider,
	setAdvancedProvider,
	loading,
	onProviderChange,
	onWebLLMTabSelect,
	webllmAvailableModels,
	onOpenAITabSelect,
	providerStatuses,
	leading,
}) => {
	const { t } = useTranslation("llm");

	const handleSelect = (provider: ServiceProvider) => {
		if (!getProviderSupport(provider).supported) return;
		setAdvancedProvider(provider);
		if (advancedProvider === provider) return;
		onProviderChange();
		if (provider === "webllm") {
			onWebLLMTabSelect(webllmAvailableModels);
		}
		if (provider === "openai") {
			onOpenAITabSelect();
		}
	};

	const labels: Record<ServiceProvider, string> = {
		transformer: t("providers.transformer", { defaultValue: "Transformer" }),
		wllama: t("providers.wllama"),
		webllm: t("providers.webllm"),
		openai: t("providers.openai"),
		openrouter: t("providers.openrouter"),
		lmstudio: t("providers.lmstudio"),
		ollama: t("providers.ollama"),
	};

	const compactLabels: Record<ServiceProvider, string> = {
		transformer: t("providers.compact.transformer"),
		wllama: t("providers.compact.wllama"),
		webllm: t("providers.compact.webllm"),
		openai: t("providers.compact.openai"),
		openrouter: t("providers.compact.openrouter"),
		lmstudio: t("providers.compact.lmstudio"),
		ollama: t("providers.compact.ollama"),
	};

	const renderStatus = (provider: ServiceProvider) => {
		const status = providerStatuses?.[provider] ?? "idle";
		if (status === "idle") return null;
		const statusLabel = t(`providerTabs.status.${status}`);
		return (
			<span
				className={
					status === "active"
						? "h-1.5 w-1.5 rounded-full bg-green-600 dark:bg-green-400"
						: "h-1.5 w-1.5 rotate-45 bg-blue-600 dark:bg-yellow-400"
				}
				aria-label={statusLabel}
				title={statusLabel}
			/>
		);
	};

	return (
		<div className="border-b bg-background/95 pb-2">
			<div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-muted/20 p-1">
				{leading ? (
					<>
						{leading}
						<span
							aria-hidden="true"
							className="mx-1 h-5 w-px shrink-0 self-center bg-border"
						/>
					</>
				) : null}
				{PROVIDER_ORDER.map((provider) => {
					const isActive = advancedProvider === provider;
					// A provider this browser cannot run stays visible but inert, so
					// the reason is discoverable rather than the tab silently missing.
					const support = getProviderSupport(provider);
					const unsupportedLabel = support.supported
						? undefined
						: `${t("browserSupport.tabUnsupported")} — ${t(
								`browserSupport.reasons.${support.reason}`,
							)}`;
					return (
						<Button
							key={provider}
							type="button"
							data-provider-tab={provider}
							data-provider-unsupported={
								support.supported ? undefined : support.reason
							}
							variant="ghost"
							onClick={() => handleSelect(provider)}
							title={unsupportedLabel}
							aria-disabled={!support.supported}
							className={`min-h-9 shrink-0 gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
								isActive
									? "bg-background text-foreground shadow-sm ring-1 ring-border"
									: "text-muted-foreground hover:bg-background/60 hover:text-foreground"
							}`}
							disabled={loading || !support.supported}
						>
							<span className="sm:hidden">{compactLabels[provider]}</span>
							<span className="hidden sm:inline">{labels[provider]}</span>
							{support.supported ? (
								renderStatus(provider)
							) : (
								<AlertTriangle
									size={12}
									className="text-amber-500"
									aria-label={t("browserSupport.tabUnsupported")}
								/>
							)}
						</Button>
					);
				})}
			</div>
		</div>
	);
};
