import { describe, expect, it } from "vitest";
import {
	buildMemonPrompt,
	conversationDesktopFiles,
	desktopFilesChangedReminder,
	memonToolsFor,
	openTasksReminder,
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
				tasks: false,
				visualize: false,
			},
		});

		expect(prompt).toContain(
			"Apps: Browser. Built in: Scheduler, Skills, Connections, pi code.",
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

	it("hands coding to pi code only while it is on, and says what a decline means", () => {
		const on = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG);
		expect(on).toContain(
			"### pi code — a coding agent you hand coding work to",
		);
		expect(on).toContain('memon_code { action: "prompt", text:');
		expect(on).toContain("The user confirms in the pi code window first");
		// Declined: code it yourself, and remember it in Memory.md.
		expect(on).toContain(
			'Declined: code it yourself with the Terminal and Files, save that now (memon_memory { action: "add", text: "Code it myself; the user does not want pi code." })',
		);
		expect(on).toContain(
			"do not use pi code again unless asked; skip it too when Memory.md says so",
		);
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG)).toContain("memon_code");

		const off = { ...DEFAULT_MEMON_FEATURE_CONFIG, piCode: false };
		const prompt = buildMemonPrompt(off);
		expect(prompt).not.toContain("pi code");
		expect(prompt).not.toContain("memon_code");
		expect(memonToolsFor(off)).not.toContain("memon_code");
	});

	it("gives every section one shape: a titled purpose, then bullets", () => {
		// Every app on, Visualize (an add-on) too.
		const everyApp = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, visualize: true },
		};
		const prompt = buildMemonPrompt(everyApp, undefined, [
			{ id: "image" as const, ready: true, model: "painter" },
		]);
		const titles = prompt.match(/^### .*$/gm) ?? [];
		expect(titles.map((title) => title.split(" — ")[0])).toEqual([
			"### Browser",
			"### Files",
			"### Terminal",
			"### Tasks",
			"### Visualize",
			"### Studio",
			"### Built in",
			"### pi code",
			"### Your home",
			"### Working with the user",
		]);
		for (const title of titles) expect(title).toMatch(/^### .+ — .+$/);
		for (const block of prompt.split("\n\n").slice(1)) {
			const [, ...lines] = block.split("\n");
			expect(lines[0]).toMatch(/^- /);
		}
		// The whole computer, pi code included, without Bot.md and Memory.md,
		// in about 2k tokens.
		expect(prompt.length).toBeLessThan(9_300);
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
				tasks: false,
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

	it("plans in Tasks when the agent has the Planner, and lists what is open past the cached prefix", () => {
		const config = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: {
				browser: false,
				files: false,
				terminal: false,
				tasks: true,
				visualize: false,
			},
		};
		const prompt = buildMemonPrompt(config, undefined, [], "/agents/Max");
		const reminder = openTasksReminder([
			{
				id: 1,
				title: "Ship v1",
				state: "done",
				checklist: [],
				createdBy: "user",
				createdAt: 0,
				updatedAt: 0,
				finishedAt: 0,
			},
			{
				id: 2,
				title: "Build the landing page",
				state: "in_progress",
				checklist: [
					{ text: "Copy", done: true },
					{ text: "Pricing", done: false },
				],
				createdBy: "user",
				createdAt: 0,
				updatedAt: 0,
			},
			{
				id: 3,
				title: "Add dark mode",
				state: "new",
				checklist: [],
				createdBy: "agent",
				createdAt: 0,
				updatedAt: 0,
			},
		]);
		expect(prompt).toContain("Apps: Tasks. Built in:");
		expect(prompt).toContain(
			"### Tasks — work you share with the user, kept across chats",
		);
		expect(prompt).toContain('memon_tasks { action: "add", title, items,');
		expect(prompt).toContain("Tasks are never cleared");
		expect(prompt).toContain("ask all your questions in one message");
		expect(prompt).toContain(
			"Give the final answer only when the task is done or dropped.",
		);
		// Open tasks change as work goes on: never in the system prompt.
		expect(prompt).not.toContain("Build the landing page");
		expect(reminder).toBe(
			"MemonOS Tasks, open when this message arrived (the Tasks window has them live):\n- #2 Build the landing page (in progress · 1/2)\n- #3 Add dark mode (new, waiting for the user's approval)",
		);
		expect(reminder).not.toContain("Ship v1");
		expect(openTasksReminder([])).toBeNull();
		expect(prompt).not.toContain("memon_notes");
		expect(prompt).toContain('- Scheduler: memon_schedule { action: "list" }');
	});

	it("tells the agent about Terminal tabs, launchers and studio apps", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, undefined, [
			{ id: "decision" as const, ready: true, model: "decider" },
		]);
		expect(prompt).toContain('{ terminal: "new", command } runs in a new tab');
		expect(prompt).toContain(
			'{ command, saveAs: "Start Site" } saves ~/Start Site.terminal instead',
		);
		expect(prompt).toContain(
			'{ action: "save", name, tool, … } keeps a setup as ~/<name>.studio',
		);
	});

	it("leaves Tasks and memon_tasks out without the Planner", () => {
		const config = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, tasks: false },
		};
		expect(buildMemonPrompt(config)).not.toContain("### Tasks");
		expect(buildMemonPrompt(config)).not.toContain("(that goes in Tasks)");
		expect(memonToolsFor(config)).not.toContain("memon_tasks");
		expect(memonToolsFor(DEFAULT_MEMON_FEATURE_CONFIG)).toContain(
			"memon_tasks",
		);
		// The Scheduler is built in.
		expect(buildMemonPrompt(config)).toContain("- Scheduler: memon_schedule");
	});

	it("keeps a conversation's system prompt as it started when Memory.md changes", () => {
		const first = {
			bot: MEMON_BOT_TEMPLATE,
			memory: `${MEMON_MEMORY_TEMPLATE}\n- Prefers short answers\n`,
		};
		const later = {
			...first,
			memory: `${first.memory}- Lives in Hanoi\n`,
		};
		expect(conversationDesktopFiles("chat-1", first)).toBe(first);
		// The prompt's start stays byte for byte, so the next message is cached.
		const kept = conversationDesktopFiles("chat-1", later);
		expect(kept).toBe(first);
		expect(buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, kept)).toBe(
			buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG, first),
		);
		// The change comes after it, with the entry numbers as they are now.
		expect(desktopFilesChangedReminder(kept, later)).toBe(
			"Changed during this chat; this is how it is now (follow it, and use these entry numbers):\n<memory_md>\n# Memory.md\n\nWhat MemonOS Bot remembers between chats. The bot adds facts here as it learns\nthem; you can edit or delete anything.\n\n[1] Prefers short answers\n[2] Lives in Hanoi\n</memory_md>",
		);
		expect(desktopFilesChangedReminder(first, first)).toBeNull();
		// Another conversation starts from the files as they are.
		expect(conversationDesktopFiles("chat-2", later)).toBe(later);
		expect(conversationDesktopFiles(undefined, later)).toBe(later);
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

	it("prefers JavaScript and names py, its packages and git in the Terminal", () => {
		const prompt = buildMemonPrompt(DEFAULT_MEMON_FEATURE_CONFIG);
		expect(prompt).toContain(
			"write JavaScript to a .js file and run node file.js",
		);
		expect(prompt).toContain(
			"py file.py: stdlib plus data, chart, image, PDF, Word, PowerPoint, Excel, audio and code-parsing packages (imports load them; pip list names them, pip show <name> says how)",
		);
		expect(prompt).toContain('plt.savefig("chart.png")');
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
		const withVisualize = {
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, visualize: true },
		};
		const on = buildMemonPrompt({ ...withVisualize, visualTheme: "glass" });
		expect(on).toContain("### Visualize — visuals the user keeps");
		expect(on).toContain("memon_visualize { openui, title? }");
		expect(on).toContain(
			'pass "glass" as the 4th argument of the root CardBlock',
		);
		// The short version is in the prompt; the reference is a call away.
		expect(on).toContain("TableBlock, BarChartBlock");
		expect(on).toContain("memon_visualize { guide: true }");
		expect(on).not.toContain("CRITICAL — Form rule");
		expect(memonToolsFor(withVisualize)).toContain("memon_visualize");

		// Off by default: an add-on the agent's settings turn on.
		const off = DEFAULT_MEMON_FEATURE_CONFIG;
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
