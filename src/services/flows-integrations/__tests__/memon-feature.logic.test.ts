import { describe, expect, it } from "vitest";
import {
	buildMemonPrompt,
	memonToolsFor,
} from "../steps/features/memon-feature";
import {
	MEMON_BOT_TEMPLATE,
	MEMON_MEMORY_TEMPLATE,
} from "@/services/memon/desktop-files";
import { DEFAULT_MEMON_FEATURE_CONFIG } from "@/services/memon/feature-config";

describe("buildMemonPrompt", () => {
	it("explains only the apps the agent has", () => {
		const prompt = buildMemonPrompt({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: {
				browser: true,
				files: false,
				terminal: false,
				notes: false,
				visualize: false,
			},
		});

		expect(prompt).toContain(
			"Apps: Browser. Built in: Scheduler, Skills, Connections.",
		);
		expect(prompt).toContain(
			"### Built in — Scheduler, Skills and Connections; change them only when the user asks",
		);
		expect(prompt).toContain('- Skills: memon_skills { action: "list" }');
		expect(prompt).toContain(
			'- Connections: memon_connections { action: "list" }',
		);
		expect(prompt).toContain("### Browser — read and use web pages");
		expect(prompt).not.toContain("### Files");
		expect(prompt).not.toContain("### Terminal");
		expect(prompt).not.toContain("### Visualize");
	});

	it("gives every section one shape: a titled purpose, then bullets", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, undefined, [
			{ id: "image" as const, ready: true, model: "painter" },
		]);
		const titles = prompt.match(/^### .*$/gm) ?? [];
		expect(titles.map((title) => title.split(" — ")[0])).toEqual([
			"### Browser",
			"### Files",
			"### Terminal",
			"### Notes",
			"### Visualize",
			"### Studio",
			"### Built in",
			"### Your home",
			"### Working with the user",
		]);
		for (const title of titles) expect(title).toMatch(/^### .+ — .+$/);
		for (const block of prompt.split("\n\n").slice(1)) {
			const [, ...lines] = block.split("\n");
			expect(lines[0]).toMatch(/^- /);
		}
		// The whole computer, without Bot.md and Memory.md, in under ~2k tokens.
		expect(prompt.length).toBeLessThan(8_500);
	});

	it("says how to fetch a file in one step, with Files and with the Terminal", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG);
		expect(prompt).toContain(
			'memon_act { action: "download", text: "<url>", to: "<folder or file>" }',
		);
		expect(prompt).toContain('{ ref: "b7", action: "download" }');
		expect(prompt).toContain("curl -sSL -o assets/hero.jpg <url>");

		const filesOnly = buildMemonPrompt({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: {
				browser: false,
				files: true,
				terminal: false,
				notes: false,
				visualize: false,
			},
		});
		expect(filesOnly).toContain('action: "download"');
		expect(filesOnly).not.toContain('{ ref: "b7", action: "download" }');
		expect(filesOnly).not.toContain("curl");
	});

	it("names the approval gates that are on", () => {
		const prompt = buildMemonPrompt({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			askBefore: { forms: true, installs: false, deletes: true },
		});
		expect(prompt).toContain(
			"Ask the user before submitting forms and deleting files.",
		);
	});

	it("plans in Notes when the agent has the Planner, as the Planner did", () => {
		const prompt = buildMemonPrompt({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: {
				browser: false,
				files: false,
				terminal: false,
				notes: true,
				visualize: false,
			},
		});
		expect(prompt).toContain("Apps: Notes. Built in:");
		expect(prompt).toContain("### Notes — your plan, which the user watches");
		expect(prompt).toContain('memon_notes { action: "set"');
		expect(prompt).toContain("ask all your questions in one message");
		expect(prompt).toContain(
			"Give the final answer only when every step is done or removed.",
		);
		expect(prompt).toContain('- Scheduler: memon_schedule { action: "list" }');
	});

	it("leaves Notes and memon_notes out without the Planner", () => {
		const config = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, notes: false },
		};
		expect(buildMemonPrompt(config)).not.toContain("### Notes");
		expect(buildMemonPrompt(config)).not.toContain("(that goes in Notes)");
		expect(memonToolsFor(config)).not.toContain("memon_notes");
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG)).toContain(
			"memon_notes",
		);
		// The Scheduler is built in.
		expect(buildMemonPrompt(config)).toContain("- Scheduler: memon_schedule");
	});

	it("explains only the studios that have a model, and drops memon_studio without one", () => {
		const studio = [
			{ id: "decision" as const, ready: true, model: "decider" },
			{ id: "transcribe" as const, ready: true, model: "whisper" },
			{
				id: "image" as const,
				ready: false,
				reason: "no model chosen in Studio",
			},
		];
		const prompt = buildMemonPrompt(
			DEFAULT_MEMON_FEATURE_CONFIG,
			undefined,
			studio,
		);
		expect(prompt).toContain("### Studio");
		expect(prompt).toContain("Ready: decision, transcribe.");
		expect(prompt).toContain('- decision: { tool: "decision"');
		expect(prompt).toContain('- transcribe: { tool: "transcribe"');
		expect(prompt).not.toContain('- image: { tool: "image"');
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG, studio)).toContain(
			"memon_studio",
		);

		const none = [studio[2]];
		expect(
			buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, undefined, none),
		).not.toContain("### Studio");
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG, none)).not.toContain(
			"memon_studio",
		);
	});

	it("prefers JavaScript and names py and git in the Terminal", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG);
		expect(prompt).toContain(
			"write JavaScript to a .js file and run node file.js",
		);
		expect(prompt).toContain(
			"Use py (standard library) only when Python is asked for or needed",
		);
		expect(prompt).toContain("git works");
	});

	it("follows Bot.md and carries Memory.md once the user has filled them", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, {
			bot: "Always answer in Vietnamese.",
			memory: "- The user researches agent quality.",
		});
		expect(prompt).toContain(
			"<bot_md>\nAlways answer in Vietnamese.\n</bot_md>",
		);
		// Entries are numbered so the agent can update or remove one by number.
		expect(prompt).toContain(
			"<memory_md>\n[1] The user researches agent quality.\n</memory_md>",
		);
		expect(prompt).toContain(
			'remember, right away: memon_memory { action: "add", text: "…" }',
		);
		expect(prompt).toContain(
			"Change Bot.md only when the user asks to change how you behave from now on",
		);
		expect(prompt).toContain("never save passwords, keys or tokens");

		const fresh = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, {
			bot: MEMON_BOT_TEMPLATE,
			memory: MEMON_MEMORY_TEMPLATE,
		});
		expect(fresh).toContain("Bot.md has no instructions yet.");
		expect(fresh).toContain("Memory.md is empty so far.");
	});

	it("teaches OpenUI with the Visualize app, in the agent's theme, and only with it", () => {
		const on = buildMemonPrompt({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			visualTheme: "glass",
		});
		expect(on).toContain("### Visualize — visuals the user keeps");
		expect(on).toContain("memon_visualize { openui, title? }");
		expect(on).toContain(
			'pass "glass" as the 4th argument of the root CardBlock',
		);
		// The short version is in the prompt; the reference is a call away.
		expect(on).toContain("TableBlock, BarChartBlock");
		expect(on).toContain("memon_visualize { guide: true }");
		expect(on).not.toContain("CRITICAL — Form rule");
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG)).toContain(
			"memon_visualize",
		);

		const off = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, visualize: false },
		};
		expect(buildMemonPrompt(off)).not.toContain("### Visualize");
		expect(buildMemonPrompt(off)).not.toContain("OpenUI");
		expect(memonToolsFor(off)).not.toContain("memon_visualize");
	});

	it("tells the agent not to undo the user's changes", () => {
		expect(buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG)).toContain(
			"do not undo their changes",
		);
	});
});
