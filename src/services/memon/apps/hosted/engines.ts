import { platform } from "@/platform/current";
import {
	type HostedAppId,
	HOSTED_APPS_INDEX_PATH,
	hostedAppEnginePath,
	isHostedAppId,
} from "./catalog";
import { type HostedEngine, isHostedEngine } from "./engine-types";

/**
 * Loads hosted apps' engines where the code runs (the offscreen document on
 * the extension, the page on web and desktop). The built apps say which of
 * them are there in apps.json: a checkout that never ran the app build has
 * none, and Files and MemonOS keep their own viewers.
 */

interface HostedAppsIndex {
	apiVersion: number;
	apps: Partial<Record<HostedAppId, { entry: string; engine: string }>>;
}

let index: Promise<HostedAppsIndex | null> | null = null;
const engines = new Map<HostedAppId, Promise<HostedEngine>>();

const loadIndex = (): Promise<HostedAppsIndex | null> => {
	if (!index) {
		index = fetch(platform.assets.url(HOSTED_APPS_INDEX_PATH))
			.then((response) => (response.ok ? response.json() : null))
			.then((value: unknown) =>
				value && typeof value === "object" && "apps" in value
					? (value as HostedAppsIndex)
					: null,
			)
			.catch(() => null);
	}
	return index;
};

/** The hosted apps this build has. */
export const availableHostedApps = async (): Promise<HostedAppId[]> => {
	const apps = (await loadIndex())?.apps ?? {};
	return Object.keys(apps).filter(isHostedAppId);
};

export const isHostedAppAvailable = async (id: HostedAppId): Promise<boolean> =>
	Boolean((await loadIndex())?.apps?.[id]);

export const loadHostedEngine = (id: HostedAppId): Promise<HostedEngine> => {
	const cached = engines.get(id);
	if (cached) return cached;
	const url = platform.assets.url(hostedAppEnginePath(id));
	const loading = (
		import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<{
			default?: unknown;
		}>
	).then((module) => {
		if (!isHostedEngine(module.default) || module.default.id !== id) {
			throw new Error(
				`The ${id} app's engine is missing or from another version; rebuild the hosted apps.`,
			);
		}
		return module.default;
	});
	engines.set(id, loading);
	// A failed load is tried again next time.
	loading.catch(() => engines.delete(id));
	return loading;
};

/** Forget what was loaded, e.g. after the apps were rebuilt (tests). */
export const resetHostedEngines = (): void => {
	index = null;
	engines.clear();
};
