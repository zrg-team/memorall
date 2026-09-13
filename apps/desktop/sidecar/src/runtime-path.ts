import { execFile, spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Where to look for `npx`, `uvx` and whatever command a local server names.
 *
 * An app started from the Dock or a desktop launcher does not inherit the PATH
 * a terminal has — nvm, Homebrew and uv all add themselves from shell startup
 * files — so a command that works in the user's terminal would not be found.
 * The login shell is asked once, and the usual install locations are added in
 * case it cannot be.
 */
export interface SearchPathDeps {
	platform: NodeJS.Platform;
	env: Readonly<Record<string, string | undefined>>;
	home: string;
	readLoginShellPath: () => Promise<string | null>;
}

const PATH_MARKER = "__MEMORALL_PATH__";

/**
 * `$SHELL -ilc`: interactive as well as login, because version managers (nvm,
 * fnm, a hand-installed Node) are usually wired up in `.zshrc`/`.bashrc`, which
 * a login-only shell does not read. Those files can be slow, hence the budget.
 * Shells that reject `-ilc` (csh, nu) fail fast and fall back to the fixed list.
 */
export function readLoginShellPath(
	shell: string | undefined,
	timeoutMs = 8_000,
): Promise<string | null> {
	if (!shell) return Promise.resolve(null);
	return new Promise((resolve) => {
		let output = "";
		let settled = false;
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		// stdout of this child is read here and never forwarded: the sidecar's own
		// stdout carries protocol frames and nothing else.
		const child = spawn(
			shell,
			["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
			{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
		);
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(null);
		}, timeoutMs);
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.once("error", () => finish(null));
		child.once("close", () => {
			const match = output.match(
				new RegExp(`${PATH_MARKER}(.*)${PATH_MARKER}`, "s"),
			);
			finish(match?.[1] ? match[1] : null);
		});
	});
}

const readEnvPath = (
	env: Readonly<Record<string, string | undefined>>,
): string | undefined =>
	env.PATH ??
	Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];

export async function resolveSearchPath(deps: SearchPathDeps): Promise<string> {
	const { platform, env, home } = deps;
	const separator = platform === "win32" ? ";" : ":";
	const parts: string[] = [];
	const add = (value: string | undefined | null) => {
		for (const entry of (value ?? "").split(separator)) {
			const trimmed = entry.trim();
			if (trimmed && !parts.includes(trimmed)) parts.push(trimmed);
		}
	};

	if (platform === "win32") {
		add(readEnvPath(env));
		if (env.APPDATA) add(`${env.APPDATA}\\npm`);
		add(`${home}\\.local\\bin`);
		add(`${home}\\.cargo\\bin`);
		return parts.join(separator);
	}

	add(await deps.readLoginShellPath());
	add(readEnvPath(env));
	for (const directory of [
		// macOS: Homebrew (Apple silicon, then Intel), MacPorts.
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/opt/local/bin",
		// Per-user installers: uv, cargo, volta, bun, npm prefix, asdf, mise.
		`${home}/.local/bin`,
		`${home}/.cargo/bin`,
		`${home}/.volta/bin`,
		`${home}/.bun/bin`,
		`${home}/.npm-global/bin`,
		`${home}/.asdf/shims`,
		`${home}/.local/share/mise/shims`,
		// Linux package managers.
		`${home}/.nix-profile/bin`,
		"/nix/var/nix/profiles/default/bin",
		"/snap/bin",
		"/usr/bin",
		"/bin",
	]) {
		add(directory);
	}
	return parts.join(separator);
}

/** `$SHELL`, or the account's shell when a launcher did not pass one on. */
const defaultShell = (): string | undefined => {
	if (process.env.SHELL) return process.env.SHELL;
	try {
		return userInfo().shell ?? undefined;
	} catch {
		return undefined;
	}
};

let cachedSearchPath: Promise<string> | null = null;

/** The search path for this process, computed once. */
export function systemSearchPath(): Promise<string> {
	cachedSearchPath ??= resolveSearchPath({
		platform: process.platform,
		env: process.env,
		home: homedir(),
		readLoginShellPath: () => readLoginShellPath(defaultShell()),
	});
	return cachedSearchPath;
}

/** A file this process could run: on POSIX that also means the execute bit. */
const isRunnableFile = (path: string): boolean => {
	try {
		if (!statSync(path).isFile()) return false;
		if (process.platform !== "win32") accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
};

export interface WhichOptions {
	platform?: NodeJS.Platform;
	pathExt?: string;
	exists?: (path: string) => boolean;
}

/** The absolute path `command` would run from, or null when it is not installed. */
export function which(
	command: string,
	searchPath: string,
	options: WhichOptions = {},
): string | null {
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? isRunnableFile;
	const extensions =
		platform === "win32"
			? (options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
					.split(";")
					.filter(Boolean)
			: [];
	const paths = platform === "win32" ? win32 : posix;
	const candidates = (base: string): string[] =>
		platform === "win32" && !paths.extname(base)
			? extensions.flatMap((ext) => [
					`${base}${ext.toLowerCase()}`,
					`${base}${ext}`,
				])
			: [base];

	if (
		paths.isAbsolute(command) ||
		command.includes("/") ||
		command.includes("\\")
	) {
		return candidates(command).find(exists) ?? null;
	}
	for (const directory of searchPath.split(paths.delimiter)) {
		if (!directory) continue;
		const found = candidates(paths.join(directory, command)).find(exists);
		if (found) return found;
	}
	return null;
}

export interface RuntimeProbe {
	found: boolean;
	path?: string;
	version?: string;
}

const readVersion = (
	path: string,
	searchPath: string,
): Promise<string | undefined> =>
	new Promise((resolve) => {
		// `.cmd` shims only run through a shell; their presence is enough.
		if (/\.(cmd|bat)$/i.test(path)) {
			resolve(undefined);
			return;
		}
		execFile(
			path,
			["--version"],
			{
				timeout: 5_000,
				windowsHide: true,
				// `npx` is a `#!/usr/bin/env node` script: without the resolved PATH
				// a macOS GUI app cannot find node to run it. Windows keeps its own
				// environment, whose `Path` key a spread would duplicate.
				...(process.platform === "win32"
					? {}
					: { env: { ...process.env, PATH: searchPath } }),
			},
			(error, stdout) => {
				resolve(
					error ? undefined : stdout.trim().split(/\r?\n/)[0] || undefined,
				);
			},
		);
	});

export async function probeRuntimes(
	commands: readonly string[],
	searchPath: string,
): Promise<Record<string, RuntimeProbe>> {
	const entries = await Promise.all(
		commands.map(async (command): Promise<[string, RuntimeProbe]> => {
			const path = which(command, searchPath);
			if (!path) return [command, { found: false }];
			const version = await readVersion(path, searchPath);
			return [command, { found: true, path, ...(version ? { version } : {}) }];
		}),
	);
	return Object.fromEntries(entries);
}
