#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootDirectory = process.cwd();
const sourceDirectory = resolve(rootDirectory, "publish", "web");
const branch = "gh-pages";
const remote = "origin";
const dryRun = process.argv.includes("--dry-run");
const apiHeaders = [
	"-H",
	"Accept: application/vnd.github+json",
	"-H",
	"X-GitHub-Api-Version: 2022-11-28",
];
const buildPollIntervalMs = 10_000;
const buildTimeoutMs = 15 * 60 * 1000;
const requiredArtifacts = [
	".nojekyll",
	"index.html",
	"privacy_policy.html",
	"privacy/index.html",
	"studio/index.html",
];

for (const artifact of requiredArtifacts) {
	if (!existsSync(join(sourceDirectory, artifact))) {
		throw new Error(
			`GitHub Pages artifact is incomplete: ${artifact}. Run yarn package:web first.`,
		);
	}
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? rootDirectory,
		encoding: "utf8",
		input: options.input,
		stdio: options.capture || options.input !== undefined ? "pipe" : "inherit",
	});
	if (result.status !== 0) {
		const output = result.stderr?.trim() || result.stdout?.trim();
		throw new Error(
			`Command failed: ${command} ${args.join(" ")}${output ? `\n${output}` : ""}`,
		);
	}
	return options.capture ? result.stdout.trim() : "";
}

function tryRun(command, args, options = {}) {
	try {
		return run(command, args, options);
	} catch {
		return null;
	}
}

function clearDirectory(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name !== ".git") {
			rmSync(join(directory, entry.name), { recursive: true, force: true });
		}
	}
}

function copyDirectoryContents(source, destination) {
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		cpSync(join(source, entry.name), join(destination, entry.name), {
			recursive: true,
		});
	}
}

function configureGitIdentity(repository) {
	const name =
		tryRun("git", ["config", "--get", "user.name"], { capture: true }) ||
		"Memorall Pages";
	const email =
		tryRun("git", ["config", "--get", "user.email"], { capture: true }) ||
		"pages@memorall.local";
	run("git", ["config", "user.name", name], { cwd: repository });
	run("git", ["config", "user.email", email], { cwd: repository });
}

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readRepository() {
	return run(
		"gh",
		["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
		{ capture: true },
	);
}

function configurePagesSource(repository) {
	const payload = JSON.stringify({
		build_type: "legacy",
		source: { branch, path: "/" },
	});
	run(
		"gh",
		[
			"api",
			"--method",
			"PUT",
			`repos/${repository}/pages`,
			...apiHeaders,
			"--input",
			"-",
		],
		{
			input: payload,
		},
	);
}

// Pushing to the branch does not always queue a build: when Pages was serving
// from another source the push is ignored, and the site keeps serving stale
// content while the branch already holds the new files. Ask for the build
// explicitly so publishing never depends on that trigger.
function requestPagesBuild(repository) {
	tryRun(
		"gh",
		[
			"api",
			"--method",
			"POST",
			`repos/${repository}/pages/builds`,
			...apiHeaders,
		],
		{ capture: true },
	);
}

function readLatestBuild(repository) {
	const output = tryRun(
		"gh",
		[
			"api",
			`repos/${repository}/pages/builds/latest`,
			...apiHeaders,
			"--jq",
			"[.status, .commit, .error.message] | @tsv",
		],
		{ capture: true },
	);
	if (!output) {
		return null;
	}
	const [status, buildCommit, error] = output.split("\t");
	return { status, commit: buildCommit, error };
}

function waitForPagesBuild(repository, commit) {
	const deadline = Date.now() + buildTimeoutMs;
	let lastStatus = "unknown";
	while (Date.now() < deadline) {
		const build = readLatestBuild(repository);
		if (build) {
			lastStatus = build.status;
			if (build.status === "errored") {
				throw new Error(
					`GitHub Pages build failed: ${build.error || "no error message reported"}`,
				);
			}
			if (build.status === "built" && build.commit === commit) {
				return;
			}
		}
		sleep(buildPollIntervalMs);
	}
	throw new Error(
		`Timed out after ${buildTimeoutMs / 60000} minutes waiting for the GitHub Pages build of ${commit} (last status: ${lastStatus}).`,
	);
}

const temporaryDirectory = mkdtempSync(
	join(tmpdir(), "memorall-pages-deploy-"),
);

try {
	const remoteUrl = run("git", ["remote", "get-url", remote], {
		capture: true,
	});
	run("git", ["init", "-q"], { cwd: temporaryDirectory });
	run("git", ["remote", "add", remote, remoteUrl], {
		cwd: temporaryDirectory,
	});
	const remoteBranch = run("git", ["ls-remote", "--heads", remote, branch], {
		cwd: temporaryDirectory,
		capture: true,
	});
	if (remoteBranch) {
		run("git", ["fetch", remote, branch], {
			cwd: temporaryDirectory,
		});
		run("git", ["checkout", "-B", branch, "FETCH_HEAD"], {
			cwd: temporaryDirectory,
		});
	} else {
		run("git", ["checkout", "--orphan", branch], {
			cwd: temporaryDirectory,
		});
	}
	clearDirectory(temporaryDirectory);
	copyDirectoryContents(sourceDirectory, temporaryDirectory);
	configureGitIdentity(temporaryDirectory);
	run("git", ["add", "-A"], { cwd: temporaryDirectory });

	const changes = run("git", ["status", "--porcelain"], {
		cwd: temporaryDirectory,
		capture: true,
	});
	if (changes) {
		run("git", ["commit", "-m", "Deploy Memorall Pages"], {
			cwd: temporaryDirectory,
		});
	}

	const commit = run("git", ["rev-parse", "HEAD"], {
		cwd: temporaryDirectory,
		capture: true,
	});

	if (dryRun) {
		console.log(
			"GitHub Pages dry run passed. No branch, Pages setting, or live site was changed.",
		);
	} else {
		if (changes) {
			run("git", ["push", remote, `${branch}:${branch}`, "--force"], {
				cwd: temporaryDirectory,
			});
		}
		const repository = readRepository();
		configurePagesSource(repository);
		requestPagesBuild(repository);
		console.log(`Waiting for the GitHub Pages build of ${commit}.`);
		waitForPagesBuild(repository, commit);
		console.log("Published landing and privacy pages at /memorall/.");
		console.log("Published the web application at /memorall/studio/.");
	}
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}
