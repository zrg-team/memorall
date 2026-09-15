import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

export interface ProviderPreferenceInput {
	/** The tabs on screen, in display order. */
	providers: readonly ServiceProvider[];
	/** Provider of the model selected for the category on screen. */
	currentProvider?: ServiceProvider | null;
	/** On-device runners that already hold a downloaded model for the category. */
	downloadedProviders: ReadonlySet<ServiceProvider>;
	/** Providers the user has set up (a saved key or server address). */
	configuredProviders: ReadonlySet<ServiceProvider>;
}

/**
 * The provider tab to open by default: where the selected model lives, then
 * where downloaded models are, then one the user already configured. Null
 * when none applies, so the page keeps its own default.
 */
export function preferredProvider({
	providers,
	currentProvider,
	downloadedProviders,
	configuredProviders,
}: ProviderPreferenceInput): ServiceProvider | null {
	if (currentProvider && providers.includes(currentProvider)) {
		return currentProvider;
	}
	return (
		providers.find((provider) => downloadedProviders.has(provider)) ??
		providers.find((provider) => configuredProviders.has(provider)) ??
		null
	);
}
