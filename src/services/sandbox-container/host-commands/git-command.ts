import { Buffer } from "buffer";
import { structuredPatch } from "diff";
import type { HttpClient } from "isomorphic-git";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import fs from "@/services/filesystem/fs";
import { sandboxPathToFsPath } from "@/services/filesystem/sandbox-paths";
import { resolvePath } from "./command-line";
import type { HostCommand, HostCommandOutput } from "./types";

/**
 * `git` for the sandbox shell, on isomorphic-git. It runs on the host because
 * git's object files are binary and the sandbox shell's view of the files is
 * text-only. The repository lives in the same "/" tree as everything else.
 */

type Git = typeof import("isomorphic-git");

const GLOBAL_CONFIG_PATH = "/.gitconfig";
const DEFAULT_AUTHOR = { name: "MemonOS Bot", email: "bot@memonos.local" };
const MAX_DIFF_BYTES = 512 * 1024;
const VERSION = "git version 2.45.0 (isomorphic-git)";

const loadGit = async (): Promise<{ git: Git; http: HttpClient }> => {
	// isomorphic-git reads the Buffer global, which browsers do not have.
	const scope = globalThis as { Buffer?: typeof Buffer };
	scope.Buffer ??= Buffer;
	const [git, http] = await Promise.all([
		import("isomorphic-git"),
		import("isomorphic-git/http/web"),
	]);
	return { git, http: http.default };
};

/**
 * isomorphic-git's fs, on ZenFS by public "/" paths. Every method is async:
 * isomorphic-git probes `readFile()` with no arguments to tell a promise fs
 * from a callback one, so a synchronous throw would make it wait forever on
 * callbacks that never come.
 */
const at = (path: string) => sandboxPathToFsPath(path);
const gitFs = {
	promises: {
		readFile: async (path: string, options?: unknown) =>
			fs.promises.readFile(at(path), options as never),
		writeFile: async (path: string, data: unknown, options?: unknown) =>
			fs.promises.writeFile(at(path), data as never, options as never),
		unlink: async (path: string) => fs.promises.unlink(at(path)),
		readdir: async (path: string) => fs.promises.readdir(at(path)),
		mkdir: async (path: string, options?: unknown) =>
			fs.promises.mkdir(at(path), options as never),
		rmdir: async (path: string) => fs.promises.rmdir(at(path)),
		stat: async (path: string) => fs.promises.stat(at(path)),
		lstat: async (path: string) => fs.promises.lstat(at(path)),
		readlink: async (path: string) => fs.promises.readlink(at(path)),
		symlink: async (target: string, path: string) =>
			fs.promises.symlink(target, at(path)),
		chmod: async (path: string, mode: number) =>
			fs.promises.chmod(at(path), mode),
	},
};

class GitError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}

/**
 * `git config --global` lives in /.gitconfig, the way real git keeps it in the
 * home folder. A file works in every context the shell runs in; the
 * offscreen document has no extension storage API.
 */
const parseGitConfig = (text: string): Record<string, string> => {
	const values: Record<string, string> = {};
	let section = "";
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith(";")) continue;
		const header = /^\[([^\s\]"]+)(?:\s+"([^"]*)")?\]$/.exec(line);
		if (header) {
			section = header[2] ? `${header[1]}.${header[2]}` : header[1];
			continue;
		}
		const entry = /^([^=\s]+)\s*=\s*(.*)$/.exec(line);
		if (entry && section) values[`${section}.${entry[1]}`] = entry[2];
	}
	return values;
};

const formatGitConfig = (values: Record<string, string>): string => {
	const sections = new Map<string, string[]>();
	for (const [key, value] of Object.entries(values)) {
		const split = key.lastIndexOf(".");
		if (split <= 0) continue;
		const section = key.slice(0, split);
		const lines = sections.get(section) ?? [];
		lines.push(`\t${key.slice(split + 1)} = ${value}`);
		sections.set(section, lines);
	}
	return [...sections]
		.map(([section, lines]) => {
			const dot = section.indexOf(".");
			const header =
				dot < 0
					? `[${section}]`
					: `[${section.slice(0, dot)} "${section.slice(dot + 1)}"]`;
			return [header, ...lines].join("\n");
		})
		.join("\n")
		.concat("\n");
};

const readGlobalConfig = async (): Promise<Record<string, string>> => {
	try {
		return parseGitConfig(
			new TextDecoder().decode(
				await fs.promises.readFile(at(GLOBAL_CONFIG_PATH)),
			),
		);
	} catch {
		return {};
	}
};

const writeGlobalConfig = (values: Record<string, string>) =>
	fs.promises.writeFile(at(GLOBAL_CONFIG_PATH), formatGitConfig(values));

const relativeTo = (root: string, path: string): string => {
	if (path === root) return ".";
	const prefix = root === "/" ? "/" : `${root}/`;
	if (!path.startsWith(prefix)) {
		throw new GitError(
			`fatal: '${path}' is outside repository at '${root}'`,
			128,
		);
	}
	return path.slice(prefix.length);
};

const isBinary = (bytes: Uint8Array): boolean =>
	bytes.subarray(0, 8000).includes(0);

const decode = (bytes: Uint8Array | null): string =>
	bytes ? new TextDecoder().decode(bytes) : "";

/** One file's diff in `git diff` form. */
const formatDiff = (
	filepath: string,
	before: Uint8Array | null,
	after: Uint8Array | null,
): string => {
	const header = [`diff --git a/${filepath} b/${filepath}`];
	if (!before) header.push("new file mode 100644");
	if (!after) header.push("deleted file mode 100644");
	if (
		(before && (isBinary(before) || before.length > MAX_DIFF_BYTES)) ||
		(after && (isBinary(after) || after.length > MAX_DIFF_BYTES))
	) {
		return [
			...header,
			`Binary files a/${filepath} and b/${filepath} differ`,
		].join("\n");
	}
	const patch = structuredPatch(
		before ? `a/${filepath}` : "/dev/null",
		after ? `b/${filepath}` : "/dev/null",
		decode(before),
		decode(after),
		"",
		"",
		{ context: 3 },
	);
	const lines = [
		...header,
		`--- ${patch.oldFileName}`,
		`+++ ${patch.newFileName}`,
	];
	for (const hunk of patch.hunks) {
		lines.push(
			`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
			...hunk.lines,
		);
	}
	return lines.join("\n");
};

/** Splits `-m msg`, `-mmsg`, `-am msg` style flags out of the arguments. */
const takeFlag = (
	args: string[],
	names: string[],
): { present: boolean; value?: string } => {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		for (const name of names) {
			if (arg === name) {
				const value = args[index + 1];
				args.splice(index, 2);
				return { present: true, value };
			}
			if (name.startsWith("--") && arg.startsWith(`${name}=`)) {
				args.splice(index, 1);
				return { present: true, value: arg.slice(name.length + 1) };
			}
		}
	}
	return { present: false };
};

const takeSwitch = (args: string[], names: string[]): boolean => {
	const index = args.findIndex((arg) => names.includes(arg));
	if (index < 0) return false;
	args.splice(index, 1);
	return true;
};

export const runGit: HostCommand = async (argv, context) => {
	const out: string[] = [];
	const err: string[] = [];
	const say = (line = "") => out.push(line);
	await documentFileSystemService.initialize();
	const { git, http } = await loadGit();
	const args = argv.slice(1);
	const sub = args.shift();
	const cwd = context.cwd;

	const findRepo = async (): Promise<string> => {
		try {
			return await git.findRoot({ fs: gitFs, filepath: cwd });
		} catch {
			throw new GitError(
				"fatal: not a git repository (or any of the parent directories): .git",
				128,
			);
		}
	};
	const config = async (dir: string, key: string) => {
		const local = await git
			.getConfig({ fs: gitFs, dir, path: key })
			.catch(() => undefined);
		if (typeof local === "string" && local) return local;
		return (await readGlobalConfig())[key];
	};
	const author = async (dir: string) => ({
		name: (await config(dir, "user.name")) ?? DEFAULT_AUTHOR.name,
		email: (await config(dir, "user.email")) ?? DEFAULT_AUTHOR.email,
	});
	const network = async (dir: string | null) => {
		const corsProxy = dir
			? await config(dir, "http.corsProxy")
			: (await readGlobalConfig())["http.corsProxy"];
		const token = (await readGlobalConfig())["credential.token"];
		return {
			http,
			...(corsProxy ? { corsProxy } : {}),
			...(token ? { onAuth: () => ({ username: token }) } : {}),
		};
	};
	const pathsArg = (dir: string, paths: string[]) =>
		paths.map((path) => relativeTo(dir, resolvePath(cwd, path)));
	const headOid = (dir: string) =>
		git.resolveRef({ fs: gitFs, dir, ref: "HEAD" }).catch(() => null);
	const readHead = async (dir: string, filepath: string) => {
		const oid = await headOid(dir);
		if (!oid) return null;
		try {
			return (await git.readBlob({ fs: gitFs, dir, oid, filepath })).blob;
		} catch {
			return null;
		}
	};
	const readWorkdir = async (dir: string, filepath: string) => {
		try {
			return new Uint8Array(
				await gitFs.promises.readFile(
					dir === "/" ? `/${filepath}` : `${dir}/${filepath}`,
				),
			);
		} catch {
			return null;
		}
	};
	const readStage = async (dir: string, filepath: string) => {
		// The stage keeps only blob ids, so walk to the file's id and read it.
		const [oid] = (await git.walk({
			fs: gitFs,
			dir,
			trees: [git.STAGE()],
			map: async (path, [entry]) => {
				if (path === ".") return undefined;
				if (path === filepath) return entry ? await entry.oid() : null;
				return filepath.startsWith(`${path}/`) ? undefined : null;
			},
		})) as Array<string | undefined>;
		if (!oid) return null;
		return (await git.readBlob({ fs: gitFs, dir, oid })).blob;
	};

	try {
		switch (sub) {
			case undefined:
			case "help":
			case "--help":
				say(
					"usage: git <init|clone|status|add|rm|commit|log|diff|branch|checkout|switch|restore|reset|config|remote|fetch|pull|push> [<args>]",
				);
				break;
			case "--version":
			case "version":
				say(VERSION);
				break;
			case "init": {
				const branch =
					takeFlag(args, ["-b", "--initial-branch"]).value ?? "main";
				const dir = resolvePath(cwd, args[0] ?? ".");
				await git.init({ fs: gitFs, dir, defaultBranch: branch });
				say(
					`Initialized empty Git repository in ${dir === "/" ? "" : dir}/.git/`,
				);
				context.filesChanged();
				break;
			}
			case "status": {
				const dir = await findRepo();
				const short = takeSwitch(args, ["-s", "--short"]);
				const branch = await git.currentBranch({ fs: gitFs, dir });
				const matrix = await git.statusMatrix({ fs: gitFs, dir });
				const staged: string[] = [];
				const unstaged: string[] = [];
				const untracked: string[] = [];
				const shortLines: string[] = [];
				for (const [file, head, workdir, stage] of matrix) {
					let x = " ";
					let y = " ";
					if (head === 0 && stage === 0 && workdir === 2) {
						untracked.push(file);
						shortLines.push(`?? ${file}`);
						continue;
					}
					if (head === 0 && stage !== 0) {
						staged.push(`new file:   ${file}`);
						x = "A";
					} else if (head === 1 && stage === 0) {
						staged.push(`deleted:    ${file}`);
						x = "D";
					} else if (head === 1 && (stage === 2 || stage === 3)) {
						staged.push(`modified:   ${file}`);
						x = "M";
					}
					if (workdir === 0 && stage !== 0) {
						unstaged.push(`deleted:    ${file}`);
						y = "D";
					} else if (workdir === 2 && (stage === 1 || stage === 3)) {
						unstaged.push(`modified:   ${file}`);
						y = "M";
					}
					if (x !== " " || y !== " ") shortLines.push(`${x}${y} ${file}`);
					// Removed from the index but still on disk.
					if (head === 1 && stage === 0 && workdir === 2) {
						untracked.push(file);
						shortLines.push(`?? ${file}`);
					}
				}
				if (short) {
					for (const line of shortLines) say(line);
					break;
				}
				say(branch ? `On branch ${branch}` : "HEAD detached");
				if (staged.length) {
					say("Changes to be committed:");
					for (const line of staged) say(`\t${line}`);
					say();
				}
				if (unstaged.length) {
					say("Changes not staged for commit:");
					for (const line of unstaged) say(`\t${line}`);
					say();
				}
				if (untracked.length) {
					say("Untracked files:");
					for (const file of untracked) say(`\t${file}`);
					say();
				}
				if (!staged.length && !unstaged.length && !untracked.length) {
					say("nothing to commit, working tree clean");
				}
				break;
			}
			case "add": {
				const dir = await findRepo();
				const all = takeSwitch(args, ["-A", "--all"]) || args.includes(".");
				if (!all && !args.length) {
					throw new GitError("Nothing specified, nothing added.");
				}
				const targets = all ? null : new Set(pathsArg(dir, args));
				const matrix = await git.statusMatrix({ fs: gitFs, dir });
				for (const [file, , workdir] of matrix) {
					if (
						targets &&
						![...targets].some(
							(target) =>
								target === "." ||
								file === target ||
								file.startsWith(`${target}/`),
						)
					) {
						continue;
					}
					if (workdir === 0)
						await git.remove({ fs: gitFs, dir, filepath: file });
					else await git.add({ fs: gitFs, dir, filepath: file });
				}
				context.filesChanged();
				break;
			}
			case "rm": {
				const dir = await findRepo();
				const cached = takeSwitch(args, ["--cached"]);
				takeSwitch(args, ["-r", "-rf", "-f"]);
				for (const filepath of pathsArg(dir, args)) {
					await git.remove({ fs: gitFs, dir, filepath });
					if (!cached) {
						await gitFs.promises
							.unlink(dir === "/" ? `/${filepath}` : `${dir}/${filepath}`)
							.catch(() => undefined);
					}
					say(`rm '${filepath}'`);
				}
				context.filesChanged();
				break;
			}
			case "commit": {
				const dir = await findRepo();
				const messages: string[] = [];
				let stageAll = false;
				for (let index = 0; index < args.length; index += 1) {
					const arg = args[index];
					if (arg === "-a" || arg === "--all") stageAll = true;
					else if (arg === "-am") {
						stageAll = true;
						messages.push(args[++index] ?? "");
					} else if (arg === "-m" || arg === "--message") {
						messages.push(args[++index] ?? "");
					} else if (arg.startsWith("--message=")) {
						messages.push(arg.slice("--message=".length));
					} else if (arg.startsWith("-m")) {
						messages.push(arg.slice(2));
					}
				}
				if (!messages.length) {
					throw new GitError(
						'error: a commit message is required here; use git commit -m "message"',
					);
				}
				let matrix = await git.statusMatrix({ fs: gitFs, dir });
				if (stageAll) {
					for (const [file, head, workdir] of matrix) {
						if (head === 0) continue;
						if (workdir === 0)
							await git.remove({ fs: gitFs, dir, filepath: file });
						else if (workdir === 2)
							await git.add({ fs: gitFs, dir, filepath: file });
					}
					matrix = await git.statusMatrix({ fs: gitFs, dir });
				}
				const changed = matrix.filter(
					([, head, , stage]) =>
						(head === 0 && stage !== 0) || (head === 1 && stage !== 1),
				).length;
				if (!changed) {
					say("nothing to commit, working tree clean");
					return { stdout: `${out.join("\n")}\n`, stderr: "", exitCode: 1 };
				}
				const message = messages.join("\n\n");
				const oid = await git.commit({
					fs: gitFs,
					dir,
					message,
					author: await author(dir),
				});
				const branch = (await git.currentBranch({ fs: gitFs, dir })) ?? "HEAD";
				say(`[${branch} ${oid.slice(0, 7)}] ${message.split("\n")[0]}`);
				say(` ${changed} file${changed === 1 ? "" : "s"} changed`);
				context.filesChanged();
				break;
			}
			case "log": {
				const dir = await findRepo();
				const oneline = takeSwitch(args, ["--oneline"]);
				let depth = Number(takeFlag(args, ["-n", "--max-count"]).value);
				const dashCount = args.find((arg) => /^-\d+$/.test(arg));
				if (dashCount) depth = Number(dashCount.slice(1));
				let commits: Awaited<ReturnType<Git["log"]>>;
				try {
					commits = await git.log({
						fs: gitFs,
						dir,
						...(Number.isFinite(depth) && depth > 0 ? { depth } : {}),
					});
				} catch {
					throw new GitError(
						"fatal: your current branch does not have any commits yet",
						128,
					);
				}
				for (const entry of commits) {
					const { commit } = entry;
					if (oneline) {
						say(`${entry.oid.slice(0, 7)} ${commit.message.split("\n")[0]}`);
						continue;
					}
					say(`commit ${entry.oid}`);
					say(`Author: ${commit.author.name} <${commit.author.email}>`);
					say(`Date:   ${new Date(commit.author.timestamp * 1000).toString()}`);
					say();
					for (const line of commit.message.trimEnd().split("\n")) {
						say(`    ${line}`);
					}
					say();
				}
				break;
			}
			case "diff": {
				const dir = await findRepo();
				const staged = takeSwitch(args, ["--staged", "--cached"]);
				takeSwitch(args, ["--"]);
				const only = args.length ? new Set(pathsArg(dir, args)) : null;
				const matrix = await git.statusMatrix({ fs: gitFs, dir });
				const sections: string[] = [];
				for (const [file, head, workdir, stage] of matrix) {
					if (
						only &&
						![...only].some(
							(target) => file === target || file.startsWith(`${target}/`),
						)
					) {
						continue;
					}
					let before: Uint8Array | null | undefined;
					let after: Uint8Array | null | undefined;
					if (staged) {
						if (head === 0 && stage === 0) continue;
						if (head === 1 && stage === 1) continue;
						before = head === 1 ? await readHead(dir, file) : null;
						after =
							stage === 0
								? null
								: stage === 2
									? await readWorkdir(dir, file)
									: await readStage(dir, file);
					} else {
						if (stage === 0) continue;
						if (workdir === 2 && stage === 2) continue;
						if (workdir === 1 && stage === 1) continue;
						before =
							stage === 1
								? await readHead(dir, file)
								: await readStage(dir, file);
						after = workdir === 0 ? null : await readWorkdir(dir, file);
					}
					if (!before && !after) continue;
					sections.push(formatDiff(file, before ?? null, after ?? null));
				}
				if (sections.length) say(sections.join("\n"));
				break;
			}
			case "branch": {
				const dir = await findRepo();
				const remove = takeFlag(args, ["-d", "-D", "--delete"]);
				if (remove.present) {
					if (!remove.value) throw new GitError("fatal: branch name required");
					await git.deleteBranch({ fs: gitFs, dir, ref: remove.value });
					say(`Deleted branch ${remove.value}.`);
					break;
				}
				const listAll = takeSwitch(args, ["-a", "--all"]);
				if (args[0]) {
					await git.branch({ fs: gitFs, dir, ref: args[0] });
					context.filesChanged();
					break;
				}
				const current = await git.currentBranch({ fs: gitFs, dir });
				for (const branch of await git.listBranches({ fs: gitFs, dir })) {
					say(`${branch === current ? "*" : " "} ${branch}`);
				}
				if (listAll) {
					for (const remote of await git.listRemotes({ fs: gitFs, dir })) {
						for (const branch of await git.listBranches({
							fs: gitFs,
							dir,
							remote: remote.remote,
						})) {
							say(`  remotes/${remote.remote}/${branch}`);
						}
					}
				}
				break;
			}
			case "checkout":
			case "switch": {
				const dir = await findRepo();
				const create =
					sub === "switch"
						? takeFlag(args, ["-c", "--create"])
						: takeFlag(args, ["-b"]);
				const dashDash = args.indexOf("--");
				if (create.present) {
					if (!create.value) throw new GitError("fatal: branch name required");
					await git.branch({
						fs: gitFs,
						dir,
						ref: create.value,
						checkout: true,
					});
					say(`Switched to a new branch '${create.value}'`);
					context.filesChanged();
					break;
				}
				const branches = await git.listBranches({ fs: gitFs, dir });
				const target = dashDash < 0 ? args[0] : undefined;
				if (target && branches.includes(target)) {
					await git.checkout({ fs: gitFs, dir, ref: target });
					say(`Switched to branch '${target}'`);
					context.filesChanged();
					break;
				}
				if (sub === "switch") {
					throw new GitError(`fatal: invalid reference: ${target ?? ""}`, 128);
				}
				const files = pathsArg(
					dir,
					dashDash < 0 ? args : args.slice(dashDash + 1),
				);
				if (!files.length) throw new GitError("fatal: nothing to check out");
				await git.checkout({
					fs: gitFs,
					dir,
					filepaths: files,
					force: true,
				});
				say(
					`Updated ${files.length} path${files.length === 1 ? "" : "s"} from the index`,
				);
				context.filesChanged();
				break;
			}
			case "restore": {
				const dir = await findRepo();
				const stagedOnly = takeSwitch(args, ["--staged", "-S"]);
				const files = pathsArg(dir, args);
				if (!files.length)
					throw new GitError("fatal: you must specify path(s) to restore");
				for (const filepath of files) {
					if (stagedOnly) await git.resetIndex({ fs: gitFs, dir, filepath });
				}
				if (!stagedOnly) {
					await git.checkout({ fs: gitFs, dir, filepaths: files, force: true });
				}
				context.filesChanged();
				break;
			}
			case "reset": {
				const dir = await findRepo();
				if (takeSwitch(args, ["--hard"])) {
					const branch = await git.currentBranch({ fs: gitFs, dir });
					await git.checkout({
						fs: gitFs,
						dir,
						ref: branch ?? "HEAD",
						force: true,
					});
					const oid = await headOid(dir);
					say(`HEAD is now at ${oid?.slice(0, 7) ?? "(no commits)"}`);
				} else {
					takeSwitch(args, ["--mixed", "--"]);
					const files = args.length
						? pathsArg(dir, args)
						: (await git.statusMatrix({ fs: gitFs, dir }))
								.filter(([, head, , stage]) => stage !== head)
								.map(([file]) => file);
					for (const filepath of files) {
						await git.resetIndex({ fs: gitFs, dir, filepath });
					}
				}
				context.filesChanged();
				break;
			}
			case "config": {
				const global = takeSwitch(args, ["--global"]);
				if (takeSwitch(args, ["--list", "-l"])) {
					const values = global ? await readGlobalConfig() : {};
					for (const [key, value] of Object.entries(values)) {
						say(`${key}=${key === "credential.token" ? "***" : value}`);
					}
					break;
				}
				const [key, value] = args;
				if (!key) throw new GitError("error: key does not contain a section");
				if (global) {
					const values = await readGlobalConfig();
					if (value === undefined) {
						if (values[key] === undefined) {
							return { stdout: "", stderr: "", exitCode: 1 };
						}
						say(key === "credential.token" ? "***" : values[key]);
					} else {
						await writeGlobalConfig({ ...values, [key]: value });
						context.filesChanged();
					}
					break;
				}
				const dir = await findRepo();
				if (value === undefined) {
					const current = await git.getConfig({ fs: gitFs, dir, path: key });
					if (current === undefined)
						return { stdout: "", stderr: "", exitCode: 1 };
					say(String(current));
				} else {
					await git.setConfig({ fs: gitFs, dir, path: key, value });
				}
				break;
			}
			case "remote": {
				const dir = await findRepo();
				const action = args[0];
				if (action === "add") {
					await git.addRemote({
						fs: gitFs,
						dir,
						remote: args[1],
						url: args[2],
					});
					break;
				}
				if (action === "remove" || action === "rm") {
					await git.deleteRemote({ fs: gitFs, dir, remote: args[1] });
					break;
				}
				const verbose = action === "-v" || action === "--verbose";
				for (const remote of await git.listRemotes({ fs: gitFs, dir })) {
					if (!verbose) say(remote.remote);
					else {
						say(`${remote.remote}\t${remote.url} (fetch)`);
						say(`${remote.remote}\t${remote.url} (push)`);
					}
				}
				break;
			}
			case "clone": {
				const depth = Number(takeFlag(args, ["--depth"]).value);
				const ref = takeFlag(args, ["-b", "--branch"]).value;
				const [url, target] = args;
				if (!url)
					throw new GitError(
						"fatal: You must specify a repository to clone.",
						128,
					);
				const name =
					target ??
					url
						.replace(/\/+$/, "")
						.split("/")
						.pop()
						?.replace(/\.git$/, "") ??
					"repo";
				const dir = resolvePath(cwd, name);
				err.push(`Cloning into '${name}'...`);
				await git.clone({
					fs: gitFs,
					dir,
					url,
					...(ref ? { ref, singleBranch: true } : {}),
					...(Number.isFinite(depth) && depth > 0 ? { depth } : {}),
					...(await network(null)),
				});
				context.filesChanged();
				break;
			}
			case "fetch": {
				const dir = await findRepo();
				const result = await git.fetch({
					fs: gitFs,
					dir,
					remote: args[0] ?? "origin",
					...(await network(dir)),
				});
				say(`From ${result.fetchHead ? (args[0] ?? "origin") : ""}`.trim());
				break;
			}
			case "pull": {
				const dir = await findRepo();
				await git.pull({
					fs: gitFs,
					dir,
					remote: args[0] ?? "origin",
					...(args[1] ? { ref: args[1] } : {}),
					author: await author(dir),
					...(await network(dir)),
				});
				say("Already up to date or fast-forwarded.");
				context.filesChanged();
				break;
			}
			case "push": {
				const dir = await findRepo();
				const result = await git.push({
					fs: gitFs,
					dir,
					remote: args[0] ?? "origin",
					...(args[1] ? { ref: args[1] } : {}),
					...(await network(dir)),
				});
				if (!result.ok)
					throw new GitError(`error: failed to push: ${result.error ?? ""}`);
				say(`Pushed to ${args[0] ?? "origin"}.`);
				break;
			}
			default:
				throw new GitError(
					`git: '${sub}' is not a git command here. See 'git help'.`,
				);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const networkHint =
			/fetch|network|cors/i.test(message) &&
			["clone", "fetch", "pull", "push"].includes(sub ?? "")
				? "\nhint: the browser could not reach that git server directly. If it does not allow cross-origin requests, set a proxy: git config --global http.corsProxy <proxy-url>. Private repositories also need: git config --global credential.token <token>"
				: "";
		err.push(`${message}${networkHint}`);
		const output: HostCommandOutput = {
			stdout: out.length ? `${out.join("\n")}\n` : "",
			stderr: `${err.join("\n")}\n`,
			exitCode: error instanceof GitError ? error.exitCode : 1,
		};
		return output;
	}
	return {
		stdout: out.length ? `${out.join("\n")}\n` : "",
		stderr: err.length ? `${err.join("\n")}\n` : "",
		exitCode: 0,
	};
};
