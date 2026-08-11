import type { SandboxProvider } from "./contracts.js";
import { SandboxError } from "./contracts.js";

export class SandboxProviderRegistry {
	private readonly providers = new Map<string, SandboxProvider>();

	register(provider: SandboxProvider): this {
		if (!provider.id.trim()) {
			throw new Error("Sandbox provider id must not be empty");
		}
		if (this.providers.has(provider.id)) {
			throw new Error(`Sandbox provider already registered: ${provider.id}`);
		}
		this.providers.set(provider.id, provider);
		return this;
	}

	get(providerId: string): SandboxProvider | undefined {
		return this.providers.get(providerId);
	}

	require(providerId: string): SandboxProvider {
		const provider = this.get(providerId);
		if (!provider) {
			throw new SandboxError(
				"provider_error",
				`Sandbox provider is not registered: ${providerId}`,
				{ providerId, operation: "provider.resolve" },
			);
		}
		return provider;
	}

	has(providerId: string): boolean {
		return this.providers.has(providerId);
	}

	list(): SandboxProvider[] {
		return [...this.providers.values()];
	}
}
