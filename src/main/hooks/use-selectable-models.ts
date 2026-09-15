import { useCallback, useEffect, useMemo, useState } from "react";
import { serviceManager } from "@/services";
import {
	PROVIDER_TO_SERVICE,
	SERVICE_TO_PROVIDER,
} from "@/services/llm/constants";
import type { ModelInfo } from "@/services/llm";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import {
	PROVIDER_REGISTRY,
	providersForCategory,
} from "@/services/llm/provider-registry";
import { resolveModelCategories } from "@/services/llm/registry/media-model-registry";
import { getModel } from "@/services/llm/registry/model-registry";
import type { LLMProvider } from "@/services/llm/interfaces/llm-model-config";
import { eq } from "drizzle-orm";
import secureSession from "@/utils/secure-session";
import { logError, logInfo } from "@/utils/logger";
import { LOCAL_PROVIDERS, type SelectableModel } from "./selectable-model";

export type { SelectableModel } from "./selectable-model";
export { providerLabel, shortModelName } from "./selectable-model";

/**
 * Every model the user could switch to right now, across every configured
 * provider.
 *
 * The models page already lists models, but per provider and one tab at a time —
 * fine for setting up, useless for "use the other one for this question". This
 * flattens the same sources into one list the composer can show.
 *
 * A local model that has not been downloaded is left out on purpose. Picking one
 * from a dropdown would start a multi-gigabyte download from a control that
 * looks instant; that belongs on the models page, where the download has a
 * progress bar and somewhere to put it.
 */

/**
 * Providers that keep their key encrypted, so the service does not exist until
 * the user unlocks it.
 *
 * `ensureAllServices` restores only the local providers and whichever service
 * the current model belongs to, so a configured OpenRouter is invisible to
 * `list()` until someone opens the models page and unlocks it. Reporting it as
 * locked is the difference between "No models yet" — which is wrong, and which
 * the user cannot act on — and telling them exactly what to do.
 */
const ENCRYPTED_PROVIDERS = Object.values(PROVIDER_REGISTRY).flatMap(
	(descriptor) =>
		descriptor.encryptionKey && descriptor.readyKey
			? [
					{
						provider: descriptor.id,
						configKey: descriptor.encryptionKey,
						readyKey: descriptor.readyKey,
					},
				]
			: [],
);

const findLockedProviders = async (
	loadedServices: ReadonlySet<string>,
	category: WorkspaceMode,
): Promise<ServiceProvider[]> => {
	const locked: ServiceProvider[] = [];
	for (const entry of ENCRYPTED_PROVIDERS) {
		if (loadedServices.has(entry.provider)) continue;
		// A locked provider that could not serve this category is not the reason
		// the list is empty.
		if (!PROVIDER_REGISTRY[entry.provider].categories.includes(category)) {
			continue;
		}
		try {
			const rows = await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, entry.configKey)),
			);
			// Check the row is the one asked for rather than trusting the filter:
			// a provider wrongly reported as locked sends the user to unlock
			// something that was never configured.
			const configured = rows.some(
				(row) => (row as { key?: string }).key === entry.configKey,
			);
			if (!configured) continue;
			// Configured but not in memory: either the key is still locked or the
			// service simply has not been created in this context yet.
			if (await secureSession.exists(entry.readyKey)) continue;
			locked.push(entry.provider);
		} catch (error) {
			logInfo(`Could not check ${entry.provider} configuration:`, error);
		}
	}
	return locked;
};

/**
 * What the runner reports, else the size its catalog entry records: not every
 * runner measures what it has cached.
 */
const localModelSize = (
	model: ModelInfo,
	provider: ServiceProvider,
): Pick<SelectableModel, "size" | "sizeByDevice"> => {
	if (model.sizeByDevice || (model.size && model.size > 0)) {
		return { size: model.size, sizeByDevice: model.sizeByDevice };
	}
	const catalogSizeGB = getModel(model.id, provider as LLMProvider)?.sizeGB;
	return catalogSizeGB ? { size: Math.round(catalogSizeGB * 1024 ** 3) } : {};
};

const isDownloaded = (model: ModelInfo): boolean =>
	model.downloaded === true || model.loaded === true;

export const toSelectable = (
	model: ModelInfo,
	serviceName: string,
	category: WorkspaceMode = "chat",
): SelectableModel | null => {
	const provider = (model.provider ?? SERVICE_TO_PROVIDER[serviceName]) as
		| ServiceProvider
		| undefined;
	if (!provider) return null;
	if (LOCAL_PROVIDERS.has(provider) && !isDownloaded(model)) return null;

	const categories = resolveModelCategories(serviceName, model.id, model);
	// A hosted model whose id reveals nothing is classified as chat. Media
	// pickers still offer it (after the recognised ones): the provider knows
	// what it serves, the id pattern only guesses.
	const unclassifiedHosted =
		category !== "chat" &&
		!LOCAL_PROVIDERS.has(provider) &&
		categories.length === 1 &&
		categories[0] === "chat";
	if (!categories.includes(category) && !unclassifiedHosted) return null;

	const isLocal = LOCAL_PROVIDERS.has(provider);
	return {
		id: model.id,
		name: model.name?.trim() || model.id,
		provider,
		serviceName,
		isLocal,
		loaded: model.loaded === true,
		categories,
		...(isLocal ? localModelSize(model, provider) : {}),
	};
};

/**
 * Local media runners are created on demand, so `list()` does not contain them
 * until something has used them. A speech picker still has to ask them what is
 * downloaded.
 */
const serviceNamesFor = (category: WorkspaceMode): string[] => {
	const names = new Set(serviceManager.llmService.list());
	if (category !== "chat") {
		for (const provider of providersForCategory(category)) {
			if (PROVIDER_REGISTRY[provider].residentLocal) {
				names.add(PROVIDER_TO_SERVICE[provider]);
			}
		}
	}
	return [...names].filter((serviceName) =>
		serviceManager.llmService.supportsCategoryFor(serviceName, category),
	);
};

export function useSelectableModels(category: WorkspaceMode = "chat") {
	const [models, setModels] = useState<SelectableModel[]>([]);
	const [lockedProviders, setLockedProviders] = useState<ServiceProvider[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The category whose list has been fetched at least once.
	const [listedCategory, setListedCategory] = useState<WorkspaceMode | null>(
		null,
	);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			// Only services that exist: asking an unconfigured provider for its
			// models is a guaranteed rejection, and one provider being down must not
			// empty the list.
			const serviceNames = serviceNamesFor(category);
			const collected: SelectableModel[] = [];
			const seen = new Set<string>();

			const results = await Promise.all(
				serviceNames.map(async (serviceName) => {
					try {
						const response =
							await serviceManager.llmService.modelsFor(serviceName);
						return { serviceName, data: response.data };
					} catch (err) {
						logInfo(`Model list unavailable for ${serviceName}:`, err);
						return { serviceName, data: [] as ModelInfo[] };
					}
				}),
			);

			for (const { serviceName, data } of results) {
				for (const model of data) {
					const selectable = toSelectable(model, serviceName, category);
					if (!selectable) continue;
					const key = `${selectable.provider}:${selectable.id}`;
					if (seen.has(key)) continue;
					seen.add(key);
					collected.push(selectable);
				}
			}

			setModels(collected);
			setLockedProviders(
				await findLockedProviders(new Set(serviceNames), category),
			);
		} catch (err) {
			logError("Failed to list selectable models:", err);
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
			setListedCategory(category);
		}
	}, [category]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const byProvider = useMemo(() => {
		const groups = new Map<ServiceProvider, SelectableModel[]>();
		for (const model of models) {
			const group = groups.get(model.provider);
			if (group) group.push(model);
			else groups.set(model.provider, [model]);
		}
		const recognised = (model: SelectableModel) =>
			model.categories?.includes(category) ? 0 : 1;
		for (const group of groups.values()) {
			group.sort(
				(left, right) =>
					recognised(left) - recognised(right) ||
					left.name.localeCompare(right.name),
			);
		}
		return groups;
	}, [models, category]);

	/**
	 * Switch the active model for this picker's category.
	 *
	 * `setCurrentModelFor` records the choice and `serveFor` makes it usable — a
	 * no-op for a hosted provider, a load for a downloaded local one. Recording
	 * first means a load that fails still leaves the user's choice visible rather
	 * than silently snapping back.
	 */
	const selectModel = useCallback(
		async (model: SelectableModel): Promise<boolean> => {
			try {
				const serviceName =
					model.serviceName || PROVIDER_TO_SERVICE[model.provider];
				await serviceManager.llmService.setCurrentModelFor(
					category,
					model.provider,
					model.id,
					serviceName,
				);
				await serviceManager.llmService.serveFor(
					serviceName,
					model.id,
					undefined,
					{ category },
				);
				await refresh();
				return true;
			} catch (err) {
				logError("Failed to select model:", err);
				setError(err instanceof Error ? err.message : String(err));
				return false;
			}
		},
		[category, refresh],
	);

	return {
		models,
		byProvider,
		lockedProviders,
		isLoading,
		/** The list for this category has been fetched at least once. */
		isListed: listedCategory === category,
		error,
		refresh,
		selectModel,
	};
}
