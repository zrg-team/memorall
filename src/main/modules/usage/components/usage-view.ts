import type {
	UsageBuckets,
	UsageFilterKey,
	UsageFilters,
	UsageMetric,
	UsageRange,
} from "../types";
import type { UsagePalette } from "./usage-palette";

/** What every card needs besides its own data. */
export interface UsageViewContext {
	metric: UsageMetric;
	range: UsageRange;
	buckets: UsageBuckets;
	locale: string;
	palette: UsagePalette;
	filters: UsageFilters;
	toggleFilter: (key: UsageFilterKey, value: string) => void;
	format: (value: number) => string;
	formatAxis: (value: number, step: number) => string;
	bucketLabel: (index: number) => string;
	bucketTitle: (index: number) => string;
	agentLabel: (agent: string) => string;
	modelLabel: (model: string) => { name: string; sub: string };
	featureLabel: (feature: string) => string;
	providerLabel: (group: string) => string;
	agentColors: Map<string, string>;
	modelColors: Map<string, string>;
	/** "vs previous 30 days" and the like. */
	compareLabel: string;
}
