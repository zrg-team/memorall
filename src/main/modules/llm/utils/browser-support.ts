import { platform } from "@/platform/current";
import type { CapabilityId } from "@/platform/contracts/core";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

/**
 * Local inference providers run entirely in the browser, so each of them needs
 * a browser feature that is not universally available. When one is missing the
 * underlying runtime fails deep in a worker with an opaque message (Wllama says
 * "No supported storage backend found"), which reads as a broken app rather
 * than a browser that cannot do this. The UI asks here first and says so.
 *
 * Providers that only talk to a remote API have no such requirement.
 */
export type UnsupportedReason = "webgpu" | "opfs";

export type ProviderSupport =
	| { supported: true }
	| { supported: false; reason: UnsupportedReason };

const REQUIREMENTS: Partial<
	Record<
		ServiceProvider,
		{ capability: CapabilityId; reason: UnsupportedReason }
	>
> = {
	// WebLLM compiles shaders and runs entirely on the GPU; there is no
	// CPU fallback.
	webllm: { capability: "ai.webgpu", reason: "webgpu" },
	// Wllama keeps downloaded GGUF weights in the origin private file system.
	wllama: { capability: "storage.opfs", reason: "opfs" },
	// Transformers.js runs on WASM when WebGPU is missing and caches weights
	// through the Cache API, so it has no hard requirement.
};

export function getProviderSupport(provider: ServiceProvider): ProviderSupport {
	const requirement = REQUIREMENTS[provider];
	if (!requirement) return { supported: true };
	if (platform.capabilities.get(requirement.capability).available) {
		return { supported: true };
	}
	return { supported: false, reason: requirement.reason };
}

export function isProviderSupported(provider: ServiceProvider): boolean {
	return getProviderSupport(provider).supported;
}

/** The on-device providers, minus any this browser cannot run. */
export function getSupportedLocalProviders(): ServiceProvider[] {
	return (["transformer", "wllama", "webllm"] as ServiceProvider[]).filter(
		isProviderSupported,
	);
}

/**
 * Whether any on-device model can run here at all.
 *
 * Every model in the recommendation catalogue needs one of these two: the ONNX
 * and MLC entries are all marked `requiresWebGPU`, and the GGUF entries need
 * somewhere to keep their weights. With neither, "Local Models" has nothing to
 * offer and should say so rather than dead-ending in model detection.
 */
export function hasLocalModelSupport(): boolean {
	return (
		platform.capabilities.get("ai.webgpu").available ||
		platform.capabilities.get("storage.opfs").available
	);
}
