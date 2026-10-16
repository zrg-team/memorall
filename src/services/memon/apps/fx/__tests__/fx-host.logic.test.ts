import { describe, expect, it } from "vitest";
import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { fxInstructions, installFxSkills } from "../fx-skills";
import {
	createFxConfigStore,
	createFxPromptHistoryStore,
	createFxSessionStore,
	FX_SESSION_REVISION_CONFLICT,
	listFxFolders,
} from "../fx-stores";
import { createFxWorkspace, fxHomeInstructionsPath } from "../fx-workspace";
import type { MemonSkillsPort } from "../../../memon-machine";
import { OutputLog } from "../output-log";

const HOME = "/agents/Bot";

/** Files by path, folders implied by them; enough of IFlowFileSystem for fx. */
class MemoryFs {
	readonly files = new Map<string, string | Uint8Array>();

	constructor(initial: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(initial))
			this.files.set(path, content);
	}

	async readFile(path: string, options?: { encoding: string }) {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`ENOENT: ${path}`);
		if (options)
			return typeof content === "string"
				? content
				: new TextDecoder().decode(content);
		return typeof content === "string"
			? new TextEncoder().encode(content)
			: content;
	}
	async writeFile(path: string, data: string | Uint8Array) {
		this.files.set(path, data);
	}
	/** Like the Memon file system's: only onto a file that is there. */
	async appendFile(path: string, data: string) {
		const existing = this.files.get(path);
		if (existing === undefined) throw new Error(`ENOENT: ${path}`);
		this.files.set(path, `${existing as string}${data}`);
	}
	async mkdir() {
		return undefined;
	}
	async stat(path: string) {
		const isDirectory = [...this.files.keys()].some((key) =>
			key.startsWith(`${path}/`),
		);
		if (!isDirectory && !this.files.has(path))
			throw new Error(`ENOENT: ${path}`);
		return { isDirectory: () => isDirectory };
	}
	async unlink(path: string) {
		this.files.delete(path);
	}
	async rm(path: string) {
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
		}
	}
	async readdir(dir: string) {
		const names = new Set<string>();
		for (const key of this.files.keys()) {
			if (key.startsWith(`${dir}/`))
				names.add(key.slice(dir.length + 1).split("/")[0] as string);
		}
		if (!names.size) throw new Error(`ENOENT: ${dir}`);
		return [...names];
	}
}

const asFs = (fs: MemoryFs) => fs as unknown as IFlowFileSystem;

describe("OutputLog", () => {
	it("replays everything from its origin and follows by cursor", async () => {
		const log = new OutputLog();
		log.write("\x1b[>1u");
		log.markPreamble();
		log.write(new TextEncoder().encode("hello "));

		const first = await log.read(log.origin);
		expect(first).toEqual({ data: "\x1b[>1uhello ", cursor: 11, reset: false });

		log.write("world");
		expect(await log.read(first.cursor)).toEqual({
			data: "world",
			cursor: 16,
			reset: false,
		});
	});

	it("tells a view whose cursor is out of the log to replay from scratch", async () => {
		const log = new OutputLog();
		log.write("abc");
		expect(await log.read(99)).toEqual({ data: "abc", cursor: 3, reset: true });
	});

	it("wakes a waiting read when output arrives", async () => {
		const log = new OutputLog();
		const pending = log.read(0, 5_000);
		log.write("late");
		expect((await pending).data).toBe("late");
	});

	it("keeps the opening mode sequences when it drops old output", async () => {
		const log = new OutputLog();
		log.write("\x1b[?2004h");
		log.markPreamble();
		const line = `${"x".repeat(999)}\n`;
		for (let i = 0; i < 4_100; i++) log.write(line);

		const replay = await log.read(0);
		expect(replay.reset).toBe(true);
		expect(replay.data.startsWith("\x1b[?2004h\r\n")).toBe(true);
		expect(replay.data.length).toBeLessThan(2_100_000);
		expect(replay.data.endsWith(line)).toBe(true);
	});
});

describe("fx stores", () => {
	it("keeps the model and mode fx picked", async () => {
		const fs = new MemoryFs();
		const store = createFxConfigStore(asFs(fs), HOME);
		expect(await store.get("model")).toBeNull();

		await store.set("model", "memorall/gpt-4o");
		await store.set("mode", "ask");

		const again = createFxConfigStore(asFs(fs), HOME);
		expect(await again.get("model")).toBe("memorall/gpt-4o");
		expect(await again.get("mode")).toBe("ask");
	});

	it("keeps prompt history per folder and skips a repeat", async () => {
		const fs = asFs(new MemoryFs());
		// fx's WebAssembly terminal names every workspace "/".
		const home = createFxPromptHistoryStore(fs, HOME, HOME);
		const app = createFxPromptHistoryStore(fs, HOME, `${HOME}/app`);
		await home.append("/", "first", 1);
		await app.append("/", "elsewhere", 2);
		expect(await home.append("/", "first", 3)).toBe("duplicate");
		await home.append("/", "second", 4);

		expect(await home.load("/", 10)).toEqual(["first", "second"]);
		expect(await home.load("/", 1)).toEqual(["second"]);

		await home.clear("/");
		expect(await home.load("/", 10)).toEqual([]);
		expect(await app.load("/", 10)).toEqual(["elsewhere"]);
	});

	it("saves conversations by revision and refuses a stale write", async () => {
		const store = createFxSessionStore(asFs(new MemoryFs()), HOME, HOME);
		const bytes = new Uint8Array([1, 2, 3]);

		const { revision } = await store.commit("s1", bytes, undefined);
		expect(await store.load("s1")).toEqual({ bytes, revision });
		expect((await store.list()).map((entry) => entry.id)).toEqual(["s1"]);

		await expect(store.commit("s1", bytes, undefined)).rejects.toMatchObject({
			code: FX_SESSION_REVISION_CONFLICT,
		});
		const next = await store.commit("s1", new Uint8Array([4]), revision);
		expect(next.revision).not.toBe(revision);

		await store.remove("s1");
		expect(await store.load("s1")).toBeNull();
		expect(await store.list()).toEqual([]);
	});

	it("lists only the conversations of the folder fx works in", async () => {
		const fs = asFs(new MemoryFs());
		const app = createFxSessionStore(fs, HOME, `${HOME}/app`);
		const home = createFxSessionStore(fs, HOME, HOME);
		await app.commit("in-app", new Uint8Array([1]), undefined);
		await home.commit("in-home", new Uint8Array([2]), undefined);

		expect((await app.list()).map((entry) => entry.id)).toEqual(["in-app"]);
		expect((await home.list()).map((entry) => entry.id)).toEqual(["in-home"]);
		// Any of them still loads: /resume <id> names one outright.
		expect(await app.load("in-home")).not.toBeNull();
	});

	it("lists the folders fx worked in, the last used first, each with its last prompt", async () => {
		const memory = new MemoryFs({
			[`${HOME}/app/package.json`]: "{}",
			[`${HOME}/site/index.html`]: "",
		});
		const fs = asFs(memory);
		let now = 1_000;
		const at = (time: number) => {
			now = time;
		};
		const realNow = Date.now;
		Date.now = () => now;
		try {
			const app = createFxSessionStore(fs, HOME, `${HOME}/app`);
			const site = createFxSessionStore(fs, HOME, `${HOME}/site`);
			const gone = createFxSessionStore(fs, HOME, `${HOME}/gone`);
			at(1_000);
			await app.commit("a1", new Uint8Array([1]), undefined);
			at(2_000);
			await site.commit("s1", new Uint8Array([1]), undefined);
			at(3_000);
			await app.commit("a2", new Uint8Array([1]), undefined);
			at(4_000);
			await gone.commit("g1", new Uint8Array([1]), undefined);
		} finally {
			Date.now = realNow;
		}
		const history = createFxPromptHistoryStore(fs, HOME, `${HOME}/app`);
		await history.append("/", "add a login page", 1);
		await history.append("/", "now   write\n its tests", 2);

		expect(await listFxFolders(fs, HOME)).toEqual([
			{
				path: `${HOME}/app`,
				lastUsed: 3_000,
				sessions: 2,
				latest: { file: "a2", title: "now write its tests" },
			},
			{
				path: `${HOME}/site`,
				lastUsed: 2_000,
				sessions: 1,
				latest: { file: "s1" },
			},
		]);
	});
});

describe("fx skills", () => {
	const skills: Pick<MemonSkillsPort, "list" | "read"> = {
		list: async () => ({
			items: [
				{
					name: "seo-audit",
					description: "Audit a site.",
					origin: "default",
					readOnly: true,
					enabled: true,
				},
				{
					name: "unused",
					description: "Off.",
					origin: "custom",
					readOnly: false,
					enabled: false,
				},
			],
		}),
		read: async (name: string) => ({
			name,
			description: "Audit a site.",
			body: "## Steps\n1. Crawl.",
			origin: "default",
			readOnly: true,
		}),
	};

	it("writes the agent's skills to ~/.fx/skills and drops ones turned off", async () => {
		const fs = new MemoryFs({ [`${HOME}/.fx/skills/old/SKILL.md`]: "stale" });

		const entries = await installFxSkills(asFs(fs), HOME, skills, "agent-1");

		expect(entries).toEqual([
			{
				name: "seo-audit",
				description: "Audit a site.",
				path: `${HOME}/.fx/skills/seo-audit/SKILL.md`,
			},
		]);
		expect(fs.files.get(`${HOME}/.fx/skills/seo-audit/SKILL.md`)).toBe(
			'---\nname: "seo-audit"\ndescription: "Audit a site."\n---\n\n## Steps\n1. Crawl.\n',
		);
		expect(fs.files.has(`${HOME}/.fx/skills/old/SKILL.md`)).toBe(false);
	});

	it("lists them for fx with where to read each one", () => {
		const text = fxInstructions([
			{
				name: "seo-audit",
				description: "Audit a site.",
				path: `${HOME}/.fx/skills/seo-audit/SKILL.md`,
			},
		]);

		expect(text).toContain("# MemonOS");
		expect(text).toContain("- shell runs in a browser sandbox (almostnode)");
		expect(text).toContain("# Skills");
		expect(text).toContain(
			`- seo-audit: Audit a site. (${HOME}/.fx/skills/seo-audit/SKILL.md)`,
		);
		expect(fxInstructions([])).not.toContain("# Skills");
	});
});

describe("fx workspace", () => {
	const sandbox = (record: unknown[]) =>
		({
			run: async (request: unknown) => {
				record.push(request);
				return {
					kind: "command",
					processId: "p1",
					events: [
						{ type: "stdout", text: "out\n" },
						{ type: "stderr", text: "warn\n" },
					],
					status: "completed",
					exitCode: 3,
					nextCursor: 1,
				};
			},
			process: async () => ({}),
		}) as unknown as IAgentSandboxService;

	it("answers the home AGENTS.md with Memorall's note, then the user's own", async () => {
		const fs = new MemoryFs({
			[fxHomeInstructionsPath(HOME)]: "Prefer pnpm.",
			[`${HOME}/app/AGENTS.md`]: "Project rules.",
		});
		const workspace = createFxWorkspace({
			fs: asFs(fs),
			getSandbox: async () => sandbox([]),
			sessionKey: "k",
			home: HOME,
			root: `${HOME}/app`,
			instructions: async () => "# MemonOS",
		});
		const signal = new AbortController().signal;

		expect(
			await workspace.readFile({ path: fxHomeInstructionsPath(HOME), signal }),
		).toBe("# MemonOS\n\nPrefer pnpm.");
		expect(
			await workspace.readFile({ path: `${HOME}/app/AGENTS.md`, signal }),
		).toBe("Project rules.");
		expect(
			await workspace.readFile({ path: `${HOME}/missing/AGENTS.md`, signal }),
		).toBeNull();
		expect(workspace.info).toEqual({
			version: 1,
			root: `${HOME}/app`,
			cwd: `${HOME}/app`,
			home: HOME,
			gitAvailable: false,
			ephemeral: true,
		});
	});

	it("runs commands in the sandbox with HOME set, keeping stdout and stderr apart", async () => {
		const calls: unknown[] = [];
		const workspace = createFxWorkspace({
			fs: asFs(new MemoryFs()),
			getSandbox: async () => sandbox(calls),
			sessionKey: "k",
			home: HOME,
			root: HOME,
			instructions: async () => "",
		});

		const result = await workspace.exec({
			command: "ls",
			cwd: HOME,
			signal: new AbortController().signal,
			timeoutMs: 30_000,
			outputLimitBytes: 64 * 1024,
		});

		expect(result).toEqual({ exitCode: 3, stdout: "out\n", stderr: "warn\n" });
		expect(calls[0]).toMatchObject({
			operation: "command",
			command: "ls",
			cwd: HOME,
			env: { HOME },
			commandTimeoutMs: 30_000,
		});
	});
});
