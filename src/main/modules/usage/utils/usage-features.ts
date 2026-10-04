import type { UsageFeatureEntry } from "../types";

/** Requests made before any tool result came back. */
export const BASE_FEATURE = "base";
/** Tools no catalog feature lists (user-picked agent tools, removed features). */
export const OTHER_FEATURE = "other";
const SOURCE_PREFIX = "source:";

export const sourceFeatureKey = (source: string) => `${SOURCE_PREFIX}${source}`;

/** `source:mcp` → `mcp`; anything else → null. */
export const sourceOfFeatureKey = (key: string): string | null =>
	key.startsWith(SOURCE_PREFIX) ? key.slice(SOURCE_PREFIX.length) : null;

const prefixOf = (name: string) => name.split(/[_.]/)[0] ?? name;

/**
 * Picks the feature that owns a tool. Several features list shared tools (many
 * vertical features list `web_search`), so the owner is the one whose own tools
 * share the tool's prefix most — `web_read` belongs with the `web_*` feature —
 * and, on a tie, the one with the fewest tools. Unlisted tools fall back to the
 * source their metadata names (`mcp`), then to "other".
 */
export const createFeatureResolver = (
	entries: readonly UsageFeatureEntry[],
) => {
	const candidates = new Map<string, UsageFeatureEntry[]>();
	for (const entry of entries) {
		for (const tool of entry.tools) {
			const list = candidates.get(tool);
			if (list) list.push(entry);
			else candidates.set(tool, [entry]);
		}
	}
	const affinity = (entry: UsageFeatureEntry, tool: string) => {
		const prefix = prefixOf(tool);
		const same = entry.tools.filter((name) => prefixOf(name) === prefix);
		return entry.tools.length ? same.length / entry.tools.length : 0;
	};
	const cache = new Map<string, string>();

	return (tool: string, source?: string): string => {
		const cacheKey = `${tool}\u0000${source ?? ""}`;
		const cached = cache.get(cacheKey);
		if (cached) return cached;
		const list = candidates.get(tool);
		let key: string;
		if (list?.length) {
			const best = [...list].sort(
				(a, b) =>
					affinity(b, tool) - affinity(a, tool) ||
					a.tools.length - b.tools.length,
			)[0];
			key = best?.key ?? OTHER_FEATURE;
		} else {
			key = source ? sourceFeatureKey(source) : OTHER_FEATURE;
		}
		cache.set(cacheKey, key);
		return key;
	};
};

export type FeatureResolver = ReturnType<typeof createFeatureResolver>;

/** Feature steps from the flow catalog, as name + tools. */
export const toFeatureEntries = (
	steps: ReadonlyArray<{
		id: string;
		name: string;
		type: string;
		metadata: Record<string, unknown>;
	}>,
): UsageFeatureEntry[] =>
	steps
		.filter((step) => step.type === "feature")
		.map((step) => {
			const { displayName, tools } = step.metadata;
			return {
				key: step.id,
				label: typeof displayName === "string" ? displayName : step.name,
				tools: Array.isArray(tools)
					? tools.filter((tool): tool is string => typeof tool === "string")
					: [],
			};
		});
