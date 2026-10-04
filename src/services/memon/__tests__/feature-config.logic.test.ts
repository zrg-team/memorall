import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { describe, expect, it } from "vitest";
import {
	applyMemonAbsorption,
	DEFAULT_MEMON_FEATURE_CONFIG,
	memonConfigFromFlow,
	normalizeMemonFeatureConfig,
} from "../feature-config";

const config = (
	memon: { enabled: boolean; config?: Record<string, unknown> } | null,
	web = true,
): UnifiedFlowConfig => ({
	graphType: "foundation",
	steps: [
		{ id: "1", name: "web-feature", enabled: web },
		{ id: "2", name: "fs-feature", enabled: true },
		{ id: "3", name: "nodejs-sandbox-feature", enabled: true },
		{ id: "4", name: "planner-feature", enabled: true },
		...(memon ? [{ id: "5", name: "memon-feature", ...memon }] : []),
	],
});

const enabledNames = (flow: UnifiedFlowConfig) =>
	flow.steps.filter((step) => step.enabled).map((step) => step.name);

describe("applyMemonAbsorption", () => {
	it("switches off web, files, sandbox and planner for runs with MemonOS Bot on", () => {
		expect(
			enabledNames(applyMemonAbsorption(config({ enabled: true }))),
		).toEqual(["memon-feature"]);
	});

	it("leaves the config alone when MemonOS Bot is off or absent", () => {
		const off = config({ enabled: false });
		expect(applyMemonAbsorption(off)).toBe(off);
		const absent = config(null);
		expect(applyMemonAbsorption(absent)).toBe(absent);
	});

	it("keeps the direct tools when the settings ask for it", () => {
		const keep = config({ enabled: true, config: { keepDirectTools: true } });
		expect(enabledNames(applyMemonAbsorption(keep))).toEqual(
			enabledNames(keep),
		);
	});

	it("gives the computer one app per app feature turned on", () => {
		const run = applyMemonAbsorption(config({ enabled: true }, false));
		expect(
			run.steps.find((step) => step.name === "memon-feature")?.config,
		).toMatchObject({
			apps: {
				browser: false,
				files: true,
				terminal: true,
				tasks: true,
				visualize: false,
			},
		});
		expect(memonConfigFromFlow(config({ enabled: true }, false))?.apps).toEqual(
			{
				browser: false,
				files: true,
				terminal: true,
				tasks: true,
				visualize: false,
			},
		);
		expect(memonConfigFromFlow(config({ enabled: false }))).toBeNull();
	});
});

describe("Visualize", () => {
	const withVisualize = (theme?: string): UnifiedFlowConfig => {
		const flow = config({ enabled: true });
		return {
			...flow,
			steps: [
				...flow.steps,
				{
					id: "6",
					name: "visualize-response",
					enabled: true,
					...(theme ? { config: { theme } } : {}),
				},
			],
		};
	};

	it("comes from Visualize response, which a MemonOS Bot run takes over", () => {
		const run = applyMemonAbsorption(withVisualize("glass"));
		expect(enabledNames(run)).toEqual(["memon-feature"]);
		expect(
			run.steps.find((step) => step.name === "memon-feature")?.config,
		).toMatchObject({ apps: { visualize: true }, visualTheme: "glass" });
		expect(memonConfigFromFlow(withVisualize())?.visualTheme).toBe("shadcn");
		expect(
			normalizeMemonFeatureConfig({ visualTheme: "neon" }).visualTheme,
		).toBe("shadcn");
	});
});

describe("normalizeMemonFeatureConfig", () => {
	it("fills every gap with defaults", () => {
		expect(normalizeMemonFeatureConfig(undefined)).toEqual(
			DEFAULT_MEMON_FEATURE_CONFIG,
		);
		expect(
			normalizeMemonFeatureConfig({
				apps: { browser: false },
				showComputer: "manual",
				askBefore: { deletes: true },
			}),
		).toEqual({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: {
				browser: false,
				files: true,
				terminal: true,
				tasks: true,
				// An add-on, off unless turned on.
				visualize: false,
			},
			showComputer: "manual",
			askBefore: { forms: true, installs: true, deletes: true },
		});
	});

	it("has pi code on unless the settings turned it off", () => {
		expect(DEFAULT_MEMON_FEATURE_CONFIG.piCode).toBe(true);
		expect(normalizeMemonFeatureConfig({}).piCode).toBe(true);
		expect(normalizeMemonFeatureConfig({ piCode: false }).piCode).toBe(false);
		expect(normalizeMemonFeatureConfig({ piCode: "no" }).piCode).toBe(true);
	});

	it("reads Tasks from a config stored when it was called Notes", () => {
		expect(
			normalizeMemonFeatureConfig({ apps: { notes: false } }).apps.tasks,
		).toBe(false);
		expect(
			normalizeMemonFeatureConfig({ apps: { notes: false, tasks: true } }).apps
				.tasks,
		).toBe(true);
	});
});
