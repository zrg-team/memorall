import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	MEMON_ABSORBED_STEP_NAMES,
	MEMON_APP_FEATURES,
	MEMON_APP_IDS,
	MEMON_STEP_NAME,
	MEMON_VISUAL_THEMES,
	type MemonAppId,
	type MemonVisualTheme,
} from "./constants";

export type MemonShowComputer = "auto" | "manual";

export interface MemonFeatureConfig {
	apps: Record<MemonAppId, boolean>;
	showComputer: MemonShowComputer;
	askBefore: { forms: boolean; installs: boolean; deletes: boolean };
	keepDirectTools: boolean;
	/**
	 * pi code, the coding agent app: on the desktop, and the agent can hand
	 * it coding work (the user confirms each time). Off, it is neither.
	 */
	piCode: boolean;
	/** Visualize's look: the theme the Visualize response feature has. */
	visualTheme: MemonVisualTheme;
}

export const DEFAULT_MEMON_FEATURE_CONFIG: MemonFeatureConfig = {
	apps: {
		browser: true,
		files: true,
		terminal: true,
		tasks: true,
		// An add-on: turned on for agents that should draw visuals.
		visualize: false,
	},
	showComputer: "auto",
	askBefore: { forms: true, installs: true, deletes: false },
	keepDirectTools: false,
	piCode: true,
	visualTheme: "shadcn",
};

const asVisualTheme = (value: unknown): MemonVisualTheme =>
	MEMON_VISUAL_THEMES.includes(value as MemonVisualTheme)
		? (value as MemonVisualTheme)
		: "shadcn";

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
	typeof value === "boolean" ? value : fallback;

/** Fills gaps in a stored step config with defaults; never throws. */
export const normalizeMemonFeatureConfig = (
	raw: unknown,
): MemonFeatureConfig => {
	const config = asRecord(raw);
	// Tasks was Notes before; a stored config may still say so.
	const stored = asRecord(config.apps);
	const apps: Record<string, unknown> = {
		...stored,
		tasks: stored.tasks ?? stored.notes,
	};
	const askBefore = asRecord(config.askBefore);
	const defaults = DEFAULT_MEMON_FEATURE_CONFIG;
	return {
		apps: Object.fromEntries(
			MEMON_APP_IDS.map((app) => [
				app,
				asBoolean(apps[app], defaults.apps[app]),
			]),
		) as Record<MemonAppId, boolean>,
		showComputer: config.showComputer === "manual" ? "manual" : "auto",
		askBefore: {
			forms: asBoolean(askBefore.forms, defaults.askBefore.forms),
			installs: asBoolean(askBefore.installs, defaults.askBefore.installs),
			deletes: asBoolean(askBefore.deletes, defaults.askBefore.deletes),
		},
		keepDirectTools: asBoolean(
			config.keepDirectTools,
			defaults.keepDirectTools,
		),
		piCode: asBoolean(config.piCode, defaults.piCode),
		visualTheme: asVisualTheme(config.visualTheme),
	};
};

/** The theme set on the Visualize response feature, if it is on. */
const visualThemeFromSteps = (
	steps: UnifiedFlowConfig["steps"],
): MemonVisualTheme => {
	const step = steps.find(
		(candidate) =>
			candidate.name === MEMON_APP_FEATURES.visualize && candidate.enabled,
	);
	return asVisualTheme(
		(step?.config as { theme?: unknown } | undefined)?.theme,
	);
};

export const getMemonStep = (config: UnifiedFlowConfig | undefined) =>
	config?.steps.find((step) => step.name === MEMON_STEP_NAME && step.enabled);

/** Which apps the computer has: one per app feature turned on in the flow. */
export const memonAppsFromSteps = (
	steps: UnifiedFlowConfig["steps"],
): Record<MemonAppId, boolean> =>
	Object.fromEntries(
		MEMON_APP_IDS.map((app) => [
			app,
			steps.some(
				(step) => step.name === MEMON_APP_FEATURES[app] && step.enabled,
			),
		]),
	) as Record<MemonAppId, boolean>;

/**
 * An agent's MemonOS Bot settings, with the apps taken from its features, or
 * null when MemonOS Bot is off.
 */
export const memonConfigFromFlow = (
	config: UnifiedFlowConfig | undefined,
): MemonFeatureConfig | null => {
	const memonStep = getMemonStep(config);
	if (!config || !memonStep) return null;
	return {
		...normalizeMemonFeatureConfig(memonStep.config),
		apps: memonAppsFromSteps(config.steps),
		visualTheme: visualThemeFromSteps(config.steps),
	};
};

/**
 * Prepares a run of a MemonOS Bot agent: the app features it has turned on
 * become the computer's apps, and are switched off as features so their
 * tools, prompts and end-of-run cleanup never reach the model (unless the
 * settings keep the direct tools).
 *
 * Doing this at the config level (instead of inside the step) keeps their
 * prompts out of the system message and does not depend on step registration
 * order, which differs between entry points.
 */
export const applyMemonAbsorption = (
	config: UnifiedFlowConfig,
): UnifiedFlowConfig => {
	const memonConfig = memonConfigFromFlow(config);
	if (!memonConfig) return config;
	const absorbed = new Set<string>(MEMON_ABSORBED_STEP_NAMES);
	return {
		...config,
		steps: config.steps.map((step) => {
			if (step.name === MEMON_STEP_NAME && step.enabled) {
				return {
					...step,
					config: {
						...step.config,
						apps: memonConfig.apps,
						visualTheme: memonConfig.visualTheme,
					},
				};
			}
			return absorbed.has(step.name) &&
				step.enabled &&
				!memonConfig.keepDirectTools
				? { ...step, enabled: false }
				: step;
		}),
	};
};
