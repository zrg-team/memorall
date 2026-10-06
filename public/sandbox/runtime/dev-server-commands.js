import { normalizePath } from "../core/sandbox-vfs.js";

/**
 * Dev-server commands the sandbox answers itself. Vite's own CLI cannot run
 * here: its bin awaits at the top level, which the runtime's script wrapper
 * cannot parse, and its bundler is native code. The sandbox has a Vite dev
 * server of its own (server-ops.js), so `npm run dev`, `vite`, `npx vite` and
 * the like start that one instead, and keep running as the command until it
 * is stopped. With a trailing `&` the server starts in the background and the
 * command returns at once, for agents whose shell waits for every command.
 */

export const DEFAULT_VITE_PORT = 5173;
const MAX_SCRIPT_DEPTH = 3;

/** Options that take a value, so the word after them is not Vite's root. */
const VITE_VALUE_OPTIONS = new Set([
	"--port",
	"--mode",
	"-m",
	"--config",
	"-c",
	"--base",
	"--logLevel",
	"-l",
	"--filter",
	"-f",
	"--clearScreen",
	"--outDir",
]);

const unquote = (word) => word.replace(/^(['"])(.*)\1$/, "$2");

const words = (text) =>
	(text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);

/** Leading NAME=value words, as an object, and the rest. */
const takeEnv = (tokens) => {
	const env = {};
	let index = 0;
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
		const [name, ...value] = tokens[index].split("=");
		env[name] = value.join("=");
		index += 1;
	}
	return { env, rest: tokens.slice(index) };
};

/** `vite [dev|serve|build|preview] [root] [options]`, read. */
const readViteArgs = (args, env) => {
	let subcommand = "dev";
	let root;
	let port;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg.startsWith("--port=")) {
			port = Number(arg.slice("--port=".length));
			continue;
		}
		if (arg === "--port") {
			port = Number(args[index + 1]);
			index += 1;
			continue;
		}
		if (arg === "--host") {
			if (args[index + 1] && !args[index + 1].startsWith("-")) index += 1;
			continue;
		}
		if (VITE_VALUE_OPTIONS.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		if (index === 0 && /^(dev|serve|build|preview|optimize)$/.test(arg)) {
			subcommand = arg === "serve" ? "dev" : arg;
			continue;
		}
		root ??= arg;
	}
	if (!Number.isInteger(port) || port <= 0) port = Number(env.PORT);
	if (!Number.isInteger(port) || port <= 0) port = DEFAULT_VITE_PORT;
	return { subcommand, root, port };
};

/** The words after a Vite launcher (`vite`, `npx vite`, its bin…), or null. */
const viteArgsOf = (tokens) => {
	const [first, second, third] = tokens;
	if (!first) return null;
	if (/^(?:\.\/)?(?:node_modules\/\.bin\/)?vite$/.test(first)) {
		return tokens.slice(1);
	}
	if (
		first === "node" &&
		/^(?:\.\/)?node_modules\/vite\/bin\/vite\.js$/.test(second ?? "")
	) {
		return tokens.slice(2);
	}
	if (/^(?:npx|pnpx|bunx)$/.test(first)) {
		const rest = tokens.slice(1).filter((word) => !/^(?:-y|--yes)$/.test(word));
		return rest[0] === "vite" ? rest.slice(1) : null;
	}
	if (/^(?:npm|pnpm|yarn)$/.test(first) && second === "exec") {
		const rest = tokens.slice(2).filter((word) => word !== "--");
		return rest[0] === "vite" ? rest.slice(1) : null;
	}
	if (/^(?:pnpm|yarn)$/.test(first) && second === "vite") {
		return tokens.slice(2);
	}
	if (first === "cross-env") return viteArgsOf(takeEnv(tokens.slice(1)).rest);
	void third;
	return null;
};

/** `npm run dev -- --port 3000` and the like: the script's name and extra words. */
const scriptCallOf = (tokens) => {
	const [first, second, third] = tokens;
	const extra = (from) => tokens.slice(from).filter((word) => word !== "--");
	if (first === "npm" && (second === "start" || second === "dev")) {
		return { name: second, extra: extra(2) };
	}
	if (first === "npm" && (second === "run" || second === "run-script")) {
		return third ? { name: third, extra: extra(3) } : null;
	}
	if ((first === "yarn" || first === "pnpm" || first === "bun") && second === "run") {
		return third ? { name: third, extra: extra(3) } : null;
	}
	if ((first === "yarn" || first === "pnpm") && second && !second.startsWith("-")) {
		return { name: second, extra: extra(2) };
	}
	return null;
};

const readScripts = (vfs, dir) => {
	try {
		const text = vfs.readFileSync(normalizePath(`${dir}/package.json`), "utf8");
		const scripts = JSON.parse(String(text)).scripts;
		return scripts && typeof scripts === "object" ? scripts : {};
	} catch {
		return {};
	}
};

/** Parts of a `&&` chain; null when it uses other shell syntax. */
const chainOf = (command) => {
	if (/[|;<>`]|\$\(/.test(command.replace(/&&/g, ""))) return null;
	return command.split("&&").map((part) => part.trim());
};

/**
 * What a command line does, when it ends in a Vite dev server: the shell
 * steps to run first (each in its folder), and the server's folder and port.
 * Null for anything else, which the shell runs as it is.
 */
export const devServerPlanOf = (command, cwd, vfs, env = {}) => {
	let line = String(command ?? "").trim();
	const background = /(?:^|[^&])&$/.test(line);
	if (background) line = line.slice(0, -1).trim();
	const chain = chainOf(line);
	if (!chain || chain.some((part) => !part)) return null;

	let dir = normalizePath(cwd || "/");
	const steps = [];
	const visit = (parts, depth) => {
		for (let index = 0; index < parts.length; index += 1) {
			const part = parts[index];
			const last = index === parts.length - 1;
			const { env: partEnv, rest } = takeEnv(words(part));
			if (rest[0] === "cd" && rest.length <= 2) {
				const target = rest[1] ?? "/";
				dir = normalizePath(target.startsWith("/") ? target : `${dir}/${target}`);
				if (last) return null;
				continue;
			}
			if (!last) {
				steps.push({ command: part, cwd: dir });
				continue;
			}
			const viteArgs = viteArgsOf(rest);
			if (viteArgs) {
				const { subcommand, root, port } = readViteArgs(viteArgs, {
					...env,
					...partEnv,
				});
				const rootDir = root
					? normalizePath(root.startsWith("/") ? root : `${dir}/${root}`)
					: dir;
				return { subcommand, rootDir, port };
			}
			const call = depth < MAX_SCRIPT_DEPTH ? scriptCallOf(rest) : null;
			const script = call ? readScripts(vfs, dir)[call.name] : undefined;
			if (typeof script !== "string") return null;
			const scriptParts = chainOf(script);
			if (!scriptParts) return null;
			scriptParts[scriptParts.length - 1] = [
				scriptParts[scriptParts.length - 1],
				...call.extra,
			].join(" ");
			steps.push({ announce: `\n> ${call.name}\n> ${script}\n\n` });
			return visit(scriptParts, depth + 1);
		}
		return null;
	};
	const server = visit(chain, 0);
	return server ? { ...server, steps, background } : null;
};

const UNSUPPORTED = {
	build:
		"vite build cannot run in this sandbox: Vite's CLI and its bundler need a full Node.js. The app is served by the sandbox's own Vite dev server: run `npm run dev` (or `vite`) and open its http://localhost address.\n",
	preview:
		"vite preview cannot run in this sandbox, and there is no build to preview: run `npm run dev` (or `vite`), which serves the app with the sandbox's own Vite dev server.\n",
	optimize: "vite optimize is not needed here: run `npm run dev` (or `vite`).\n",
};

const banner = (plan, url, vfs) => {
	let hasIndex = false;
	try {
		hasIndex = vfs.existsSync(normalizePath(`${plan.rootDir}/index.html`));
	} catch {
		hasIndex = false;
	}
	return [
		"",
		"  VITE (MemonOS built-in dev server)  ready",
		"",
		`  ➜  Local:   ${url}`,
		`  ➜  Root:    ${plan.rootDir}`,
		"",
		"  It serves index.html and the files it imports (React, TypeScript, CSS,",
		"  Tailwind) and reloads the page when files change; vite.config plugins",
		"  do not run.",
		...(hasIndex
			? []
			: [
					"",
					`  No index.html in ${plan.rootDir}: Vite serves the app from there.`,
				]),
		...(plan.background
			? ["", "  Running in the background; run the command again to restart it."]
			: []),
		"",
		"",
	].join("\n");
};

/** A shell command's environment (a Map), as an object. */
const envOf = (ctx) => {
	const env = {};
	ctx?.env?.forEach?.((value, name) => {
		env[name] = value;
	});
	return env;
};

const quoteWord = (word) => `'${String(word).replace(/'/g, `'"'"'`)}'`;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The words npm passes on to a script (`npm run dev -- --port 5180`). The
 * sandbox's npm drops them, so the command the script runs reads them from
 * the line that called npm: after `--`, up to the next operator or redirect.
 */
export const npmPassedArgs = (line, scriptName) => {
	if (!line || !scriptName) return [];
	const name = escapeRegExp(scriptName);
	const call =
		scriptName === "start" || scriptName === "test"
			? `(?:run(?:-script)?\\s+)?${name}`
			: `run(?:-script)?\\s+${name}`;
	const match = new RegExp(
		`(?:^|[\\s;&|(])npm\\s+${call}\\s+--\\s+(.*?)(?=\\s+\\d*[<>]|\\s*[|;&<>)]|\\s*$)`,
	).exec(line);
	return match ? words(match[1]) : [];
};

/** Vite's own entry, as `node_modules/.bin/vite` runs it. */
const VITE_BIN = /\/node_modules\/vite\/bin\/vite\.js$/;

/**
 * `vite` and `npx` as commands of the sandbox's shell, and Vite's bin when
 * `node` runs it: a dev server started anywhere in a command line (after a
 * `;`, in a pipe, from `npm run dev` inside a longer line). The shell runs
 * `cmd &` in the foreground, so these start the server and return at once,
 * the banner as their output, for what follows on the line to run.
 */
export const devServerShellCommands = (io) => {
	const vite = async (args, ctx) => {
		const cwd = normalizePath(ctx?.cwd || "/");
		const env = envOf(ctx);
		// Run by `npm run <script> -- …`: the words npm should have passed on.
		const passed = npmPassedArgs(io.command, env.npm_lifecycle_event);
		const { subcommand, root, port } = readViteArgs([...args, ...passed], env);
		const plan = {
			subcommand,
			port,
			rootDir: root
				? normalizePath(root.startsWith("/") ? root : `${cwd}/${root}`)
				: cwd,
			steps: [],
			background: true,
		};
		let stdout = "";
		let stderr = "";
		const { exitCode } = await runDevServerPlan(plan, {
			...io,
			signal: new AbortController().signal,
			onStdout: (text) => {
				stdout += text;
			},
			onStderr: (text) => {
				stderr += text;
			},
			runShell: async () => ({ exitCode: 0 }),
			stopServer: async () => undefined,
		});
		return { stdout, stderr, exitCode };
	};

	const npx = async (args, ctx) => {
		const words = args.filter((word) => !/^(?:-y|--yes)$/.test(word));
		if (words[0] === "--") words.shift();
		const [name, ...rest] = words;
		if (!name) {
			return { stdout: "", stderr: "Usage: npx <command> [args...]\n", exitCode: 1 };
		}
		if (name === "vite") return vite(rest, ctx);
		const cwd = normalizePath(ctx?.cwd || "/");
		const bin = normalizePath(`${cwd}/node_modules/.bin/${name}`);
		if (io.vfs.existsSync(bin) && typeof ctx?.exec === "function") {
			return ctx.exec([bin, ...rest].map(quoteWord).join(" "), { cwd });
		}
		return {
			stdout: "",
			stderr: `npx: ${name} is not installed in ${cwd}/node_modules, and npx cannot download packages in this sandbox: npm install it first (pure-JavaScript packages work).\n`,
			exitCode: 127,
		};
	};

	return {
		commands: { vite, npx },
		runScript: (path, args, ctx) => (VITE_BIN.test(path) ? vite(args, ctx) : null),
	};
};

/**
 * Runs a dev-server plan as a command: its shell steps, then the server,
 * which keeps the command running until it is stopped (or, in the
 * background, returns once it serves).
 */
export const runDevServerPlan = async (
	plan,
	{ vfs, signal, onStdout, onStderr, runShell, claimServer, startServer, stopServer },
) => {
	for (const step of plan.steps) {
		if (step.announce) {
			onStdout(step.announce);
			continue;
		}
		const result = await runShell(step.command, step.cwd);
		const exitCode = result?.exitCode ?? 0;
		if (exitCode !== 0) return { exitCode };
		if (signal.aborted) return { exitCode: 130 };
	}
	const unsupported = UNSUPPORTED[plan.subcommand];
	if (unsupported) {
		onStderr(unsupported);
		return { exitCode: 1 };
	}
	const refusal = claimServer(plan.port);
	if (refusal) {
		onStderr(refusal);
		return { exitCode: 1 };
	}
	const server = await startServer({
		kind: "vite",
		rootDir: plan.rootDir,
		port: plan.port,
	});
	onStdout(banner(plan, `http://localhost:${plan.port}/`, vfs));
	if (plan.background) return { exitCode: 0 };
	if (!signal.aborted) {
		await new Promise((resolve) =>
			signal.addEventListener("abort", resolve, { once: true }),
		);
	}
	await stopServer(plan.port, server);
	return { exitCode: 130 };
};
