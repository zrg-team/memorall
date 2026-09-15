import React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import {
	PROVIDER_ORDER,
	PROVIDER_REGISTRY,
} from "@/services/llm/provider-registry";
import { getProviderSupport } from "../utils/browser-support";

export type ProviderStatus = "active" | "configured" | "idle";

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
	/** Providers to show, in registry order. Defaults to every provider. */
	providers?: readonly ServiceProvider[];
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
	providers = PROVIDER_ORDER,
}) => {
	const { t } = useTranslation("llm");

	const handleSelect = (provider: ServiceProvider) => {
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

	const label = (provider: ServiceProvider) =>
		t(`providers.${provider}`, {
			defaultValue: PROVIDER_REGISTRY[provider].label,
		});
	const compactLabel = (provider: ServiceProvider) =>
		t(`providers.compact.${provider}`, {
			defaultValue: PROVIDER_REGISTRY[provider].shortLabel,
		});

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
				{PROVIDER_ORDER.filter((provider) => providers.includes(provider)).map(
					(provider) => {
						const isActive = advancedProvider === provider;
						// A provider this browser cannot run stays selectable: the panel
						// explains why, which a disabled tab could only do through a
						// tooltip no touch device ever shows.
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
								className={`min-h-9 shrink-0 gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
									isActive
										? "bg-background text-foreground shadow-sm ring-1 ring-border"
										: "text-muted-foreground hover:bg-background/60 hover:text-foreground"
								} ${support.supported ? "" : "opacity-70"}`}
								disabled={loading}
							>
								<span className="sm:hidden">{compactLabel(provider)}</span>
								<span className="hidden sm:inline">{label(provider)}</span>
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
					},
				)}
			</div>
		</div>
	);
};
