import type {
	DeviceDownloadSizes,
	ModelReasoning,
} from "@/services/llm/interfaces/base-llm";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { ModelCategory } from "@/services/llm/interfaces/model-category";
import {
	LOCAL_RUNNER_PROVIDERS,
	PROVIDER_REGISTRY,
} from "@/services/llm/provider-registry";

/**
 * What a model looks like to anything choosing between them.
 *
 * Split from `use-selectable-models` so the picker can import the shape and the
 * naming rules without importing the service tree behind the hook — which
 * reaches the document filesystem and pdf.js, and would drag both into any
 * render of the composer.
 */
export interface SelectableModel {
	id: string;
	name: string;
	provider: ServiceProvider;
	serviceName: string;
	isLocal: boolean;
	loaded: boolean;
	/** What the model does; absent means chat. */
	categories?: readonly ModelCategory[];
	/** Local models: bytes on disk / to download (see `downloadBytesFor`). */
	size?: number;
	sizeByDevice?: DeviceDownloadSizes;
	/** Reasoning models: the effort levels they accept. */
	reasoning?: ModelReasoning;
}

/** Runs in the browser, so a model is only instantly selectable once local. */
export const LOCAL_PROVIDERS: ReadonlySet<ServiceProvider> =
	LOCAL_RUNNER_PROVIDERS;

export const providerLabel = (provider: ServiceProvider): string =>
	PROVIDER_REGISTRY[provider]?.shortLabel ?? provider;

/**
 * The tail of an id is what distinguishes two models; the vendor prefix and the
 * weight file's extension are noise in a control this small.
 */
export const shortModelName = (model: Pick<SelectableModel, "id" | "name">) => {
	const source = model.name?.trim() || model.id;
	const tail = source.split("/").pop() ?? source;
	return tail.replace(/\.(gguf|bin|safetensors)$/i, "");
};

/**
 * The selected model's entry in a listing, found by id the way the model
 * picker finds it. The provider only breaks a tie: a listing may name its
 * models by the API they speak (OpenRouter's come back as "openai") rather
 * than by the provider the selection was made under.
 */
export const findSelectedModel = <
	T extends Pick<SelectableModel, "id" | "provider">,
>(
	models: readonly T[],
	modelId: string,
	provider?: ServiceProvider,
): T | undefined => {
	const sameId = models.filter((candidate) => candidate.id === modelId);
	return (
		sameId.find((candidate) => candidate.provider === provider) ?? sameId[0]
	);
};
