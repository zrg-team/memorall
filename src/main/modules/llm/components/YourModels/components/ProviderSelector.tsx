import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import React from "react";
import {
	PROVIDER_ORDER,
	PROVIDER_REGISTRY,
} from "@/services/llm/provider-registry";
import { useTranslation } from "react-i18next";

interface ProviderSelectorProps {
	quickProvider: ServiceProvider;
	setQuickProvider: (provider: ServiceProvider) => void;
	loading: boolean;
	allowedProviders?: ServiceProvider[];
}

const ALL_PROVIDERS = PROVIDER_ORDER;

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
	quickProvider,
	setQuickProvider,
	loading,
	allowedProviders = [...ALL_PROVIDERS],
}) => {
	const { t } = useTranslation("llm");

	const providerLabel = (provider: ServiceProvider) => {
		const descriptor = PROVIDER_REGISTRY[provider];
		const name = t(`providers.${provider}`, { defaultValue: descriptor.label });
		if (descriptor.residentLocal) return name;
		return `${name} (${descriptor.isLocal ? "Local" : "Cloud"})`;
	};

	return (
		<div className="flex items-center gap-2">
			<select
				value={quickProvider}
				onChange={(e) => setQuickProvider(e.target.value as ServiceProvider)}
				className="text-xs border rounded px-2 py-1 bg-background"
				disabled={loading}
			>
				{ALL_PROVIDERS.filter((provider) =>
					allowedProviders.includes(provider),
				).map((provider) => (
					<option key={provider} value={provider}>
						{providerLabel(provider)}
					</option>
				))}
			</select>
		</div>
	);
};
