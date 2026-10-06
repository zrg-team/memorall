import { describe, expect, it, vi } from "vitest";
import {
	devServerPlanOf,
	npmPassedArgs,
	runDevServerPlan,
} from "../../../../public/sandbox/runtime/dev-server-commands.js";

/** A sandbox file system with these files. */
const vfsWith = (files: Record<string, string>) => ({
	readFileSync: (path: string) => {
		if (!(path in files)) throw new Error(`ENOENT: ${path}`);
		return files[path];
	},
	existsSync: (path: string) => path in files,
});

const app = vfsWith({
	"/work/app/package.json": JSON.stringify({
		scripts: {
			dev: "vite --host",
			start: "vite --port 3000",
			build: "tsc && vite build",
			api: "node server.js",
		},
	}),
	"/work/app/index.html": "<div id=root></div>",
});

const planOf = (command: string, cwd = "/work/app") =>
	devServerPlanOf(command, cwd, app);

describe("dev-server commands", () => {
	it("takes every way of starting Vite to the built-in server", () => {
		for (const command of [
			"vite",
			"vite dev",
			"vite serve --host",
			"npx vite",
			"npx --yes vite",
			"npm exec -- vite",
			"pnpm vite",
			"./node_modules/.bin/vite",
			"node node_modules/vite/bin/vite.js",
			"npm run dev",
			"yarn dev",
			"pnpm run dev",
		]) {
			expect(planOf(command), command).toMatchObject({
				subcommand: "dev",
				rootDir: "/work/app",
				port: 5173,
				background: false,
			});
		}
	});

	it("reads the port, the folder and a background start", () => {
		expect(planOf("npm start")).toMatchObject({ port: 3000 });
		expect(planOf("npm run dev -- --port 4000")).toMatchObject({ port: 4000 });
		expect(planOf("PORT=8080 vite")).toMatchObject({ port: 8080 });
		expect(planOf("vite --port=5000 site")).toMatchObject({
			port: 5000,
			rootDir: "/work/app/site",
		});
		expect(planOf("cd app && npm run dev &", "/work")).toMatchObject({
			rootDir: "/work/app",
			background: true,
			steps: [{ announce: "\n> dev\n> vite --host\n\n" }],
		});
	});

	it("runs what comes before the server, in its folder", () => {
		expect(planOf("npm install && npm run dev")).toMatchObject({
			steps: [
				{ command: "npm install", cwd: "/work/app" },
				{ announce: expect.stringContaining("> dev") },
			],
		});
		expect(planOf("npm run build")).toMatchObject({
			subcommand: "build",
			steps: [
				{ announce: expect.stringContaining("> build") },
				{ command: "tsc", cwd: "/work/app" },
			],
		});
	});

	it("reads back the words npm passes to a script", () => {
		expect(
			npmPassedArgs(
				'timeout 6 npm run dev -- --port 5180 2>&1 | head -20; echo "EXIT:$?"',
				"dev",
			),
		).toEqual(["--port", "5180"]);
		expect(
			npmPassedArgs("cd app && npm start -- --host --port 3000 &", "start"),
		).toEqual(["--host", "--port", "3000"]);
		expect(npmPassedArgs("npm run dev -- --port=4000;ls", "dev")).toEqual([
			"--port=4000",
		]);
		// Another script's words, or none.
		expect(npmPassedArgs("npm run build -- --port 1", "dev")).toEqual([]);
		expect(npmPassedArgs("npm run dev | head", "dev")).toEqual([]);
		expect(npmPassedArgs(undefined, "dev")).toEqual([]);
	});

	it("leaves everything else to the shell", () => {
		for (const command of [
			"npm run api",
			"node server.js",
			"npm install",
			"vite | tee log.txt",
			"npm run missing",
			"echo vite",
		]) {
			expect(planOf(command), command).toBeNull();
		}
	});

	it("serves until stopped, then stops only its own server", async () => {
		const plan = planOf("npm install && npm run dev");
		if (!plan) throw new Error("expected a plan");
		const controller = new AbortController();
		const out: string[] = [];
		const server = { id: "vite" };
		const stopServer = vi.fn(async () => undefined);
		const running = runDevServerPlan(plan, {
			vfs: app,
			signal: controller.signal,
			onStdout: (text: string) => out.push(text),
			onStderr: (text: string) => out.push(text),
			runShell: vi.fn(async () => ({ exitCode: 0 })),
			claimServer: () => null,
			startServer: vi.fn(async () => server),
			stopServer,
		});
		await vi.waitFor(() =>
			expect(out.join("")).toContain("Local:   http://localhost:5173/"),
		);
		expect(stopServer).not.toHaveBeenCalled();

		controller.abort();
		await expect(running).resolves.toEqual({ exitCode: 130 });
		expect(stopServer).toHaveBeenCalledWith(5173, server);
	});

	it("says what to run instead of a build, and keeps to one server", async () => {
		const io = (claim: string | null) => {
			const err: string[] = [];
			return {
				err,
				io: {
					vfs: app,
					signal: new AbortController().signal,
					onStdout: () => undefined,
					onStderr: (text: string) => err.push(text),
					runShell: async () => ({ exitCode: 0 }),
					claimServer: () => claim,
					startServer: vi.fn(async () => ({})),
					stopServer: async () => undefined,
				},
			};
		};
		const build = io(null);
		await expect(
			runDevServerPlan(planOf("vite build") as never, build.io),
		).resolves.toEqual({ exitCode: 1 });
		expect(build.err.join("")).toContain("run `npm run dev`");

		const busy = io("Error: listen EADDRINUSE: one server runs at a time\n");
		await expect(
			runDevServerPlan(planOf("vite") as never, busy.io),
		).resolves.toEqual({ exitCode: 1 });
		expect(busy.io.startServer).not.toHaveBeenCalled();
	});
});
