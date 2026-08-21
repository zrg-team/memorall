import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROTECTED_BRANCH_NAME = /^(?:main|master|develop)$/u;
const CONVENTIONAL_BRANCH_NAME =
	/^(?:feat|fix|chore|refactor|test|docs|style|perf|build|ci|revert|release|hotfix)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COPILOT_CONVENTIONAL_BRANCH_NAME =
	/^copilot\/(?:feat|fix|chore|refactor|test|docs|style|perf|build|ci|revert|release|hotfix)-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const BRANCH_NAMING_STANDARD =
	"Use main, master, or develop; otherwise use <type>/<lowercase-kebab-case-description>. Allowed types: feat, fix, chore, refactor, test, docs, style, perf, build, ci, revert, release, hotfix. Copilot branches may use copilot/<type>-<lowercase-kebab-case-description>.";

export function normalizeBranchName(branchName) {
	return branchName
		.trim()
		.replace(/^refs\/heads\//u, "")
		.replace(/^refs\/remotes\/[^/]+\//u, "");
}

export function validateBranchName(branchName) {
	const normalizedBranchName = normalizeBranchName(branchName);

	if (!normalizedBranchName) {
		return { ok: true, branchName: "", reason: "detached HEAD" };
	}

	if (
		!PROTECTED_BRANCH_NAME.test(normalizedBranchName) &&
		!CONVENTIONAL_BRANCH_NAME.test(normalizedBranchName) &&
		!COPILOT_CONVENTIONAL_BRANCH_NAME.test(normalizedBranchName)
	) {
		return {
			ok: false,
			branchName: normalizedBranchName,
			reason: BRANCH_NAMING_STANDARD,
		};
	}

	return { ok: true, branchName: normalizedBranchName };
}

function readCurrentBranch() {
	const ciBranchName =
		process.env.GITHUB_HEAD_REF ||
		process.env.CI_COMMIT_REF_NAME ||
		process.env.BRANCH_NAME ||
		(process.env.GITHUB_REF_TYPE === "branch"
			? process.env.GITHUB_REF_NAME
			: "");

	if (ciBranchName) {
		return ciBranchName;
	}

	try {
		return execFileSync("git", ["branch", "--show-current"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return "";
	}
}

export function checkBranchName(branchName = readCurrentBranch()) {
	const result = validateBranchName(branchName);

	if (!result.ok) {
		console.error(`\nERROR: Invalid branch name: ${result.branchName}`);
		console.error(result.reason);
		return 1;
	}

	if (result.branchName) {
		console.log(`Branch name accepted: ${result.branchName}`);
	} else {
		console.log("Branch-name check skipped for detached HEAD.");
	}

	return 0;
}

const isMainModule =
	process.argv[1] &&
	fileURLToPath(import.meta.url).toLowerCase() ===
		process.argv[1].toLowerCase();

if (isMainModule) {
	const explicitBranchIndex = process.argv.indexOf("--branch");
	const explicitBranchName =
		explicitBranchIndex >= 0
			? process.argv[explicitBranchIndex + 1]
			: undefined;
	process.exitCode = checkBranchName(explicitBranchName);
}
