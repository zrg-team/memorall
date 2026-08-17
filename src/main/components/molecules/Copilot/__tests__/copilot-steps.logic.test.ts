import { describe, expect, it } from "vitest";
import {
	getCopilotNavigationId,
	workspaceNavigationItems,
} from "@/main/components/app-navigation";
import enCommon from "@/main/i18n/locales/en/common.json";
import vnCommon from "@/main/i18n/locales/vn/common.json";
import {
	buildCopilotSteps,
	COPILOT_WORKSPACE_STOP_COUNT,
	type CopilotStep,
} from "../copilot-steps";

/** Resolves `a.b.c` against a locale bundle, returning undefined on a miss. */
const lookup = (bundle: unknown, key: string): unknown =>
	key
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object"
					? (node as Record<string, unknown>)[part]
					: undefined,
			bundle,
		);

const translator = (bundle: unknown) => (key: string) => {
	const value = lookup(bundle, key);
	// i18next echoes the key on a miss; the tests below assert against that.
	return typeof value === "string" ? value : key;
};

const t = translator(enCommon);

const fresh = () => buildCopilotSteps(t, { hasLLMConfigured: false });
const ready = () => buildCopilotSteps(t, { hasLLMConfigured: true });

/** The workspace tabs the tour is expected to stop at, in nav order. */
const TOURED_PATHS = [
	"/agents",
	"/files",
	"/memory",
	"/connections",
	"/skills",
	"/llm",
];

describe("copilot tour steps", () => {
	it("opens on the setup screen, walks every workspace stop, and closes on how to start", () => {
		const steps = fresh();

		expect(steps).toHaveLength(COPILOT_WORKSPACE_STOP_COUNT + 2);
		expect(steps[0].id).toBe("welcome");
		expect(steps[0].target).toContain("no-models-screen");
		expect(steps[steps.length - 1].id).toBe("start-here");
		expect(steps[steps.length - 1].navigationPath).toBe("/");
	});

	// The tour is the only place a new user learns these tabs exist, so a tab
	// added to the nav without a stop here would go unexplained.
	it("visits every workspace tab that carries a copilot id", () => {
		const visited = fresh()
			.map((step) => step.navigationPath)
			.filter((path): path is string => Boolean(path) && path !== "/");

		const navPathsWithCopilotId = workspaceNavigationItems
			.map((item) => item.path)
			.filter((path) => getCopilotNavigationId(path));

		expect(visited).toEqual(navPathsWithCopilotId);
		// Guards the ordering the copy leans on: who answers → what it knows →
		// what it can do → what it thinks with.
		expect(visited).toEqual(TOURED_PATHS);
	});

	it("targets nav ids that the shared navigation table actually produces", () => {
		for (const step of fresh()) {
			const path = step.navigationPath;
			if (!path || path === "/") continue;

			const navId = getCopilotNavigationId(path);
			expect(navId).toBeTruthy();
			expect(step.target).toBe(`[data-copilot~="header-nav-${navId}"]`);
			expect(step.fallbackTarget).toBe(`[data-copilot~="mobile-nav-${navId}"]`);
			expect(step.cursorTarget).toBe(`copilot-header-nav-${navId}`);
		}
	});

	// A tour replayed from Settings after setup has no setup screen to point at.
	it("swaps the opening and closing steps once a model is configured", () => {
		const [opening] = ready();
		const closing = ready()[ready().length - 1];

		expect(opening.target).toContain("chat-center");
		expect(closing.target).toContain("chat-center");
		expect(opening.content).not.toBe(fresh()[0].content);

		for (const step of ready()) {
			expect(step.fallbackTarget).toBeTruthy();
		}
	});

	it("keeps step ids unique so progress cannot stall", () => {
		const ids = fresh().map((step) => step.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each([
		["en", enCommon],
		["vn", vnCommon],
	])("has translated copy for every step in %s", (_locale, bundle) => {
		const steps: CopilotStep[] = buildCopilotSteps(translator(bundle), {
			hasLLMConfigured: false,
		}).concat(
			buildCopilotSteps(translator(bundle), { hasLLMConfigured: true }),
		);

		for (const step of steps) {
			for (const value of [
				step.title,
				step.content,
				step.cursorMessage,
				step.agentMessage,
			]) {
				expect(value).toBeTruthy();
				// A missing key comes back as the key itself.
				expect(value).not.toContain("copilot.steps.");
			}
		}
	});
});
