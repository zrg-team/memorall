import { usesHostCommand } from "./host-commands";
import {
	parseSegment,
	splitChain,
	splitPipeline,
} from "./host-commands/command-line";

/**
 * The shell's own tools: they never start `node`, so they leave alone the
 * stdin and output streaming that almostnode keeps for one running command
 * (a server). Runners of other commands (bash, xargs, timeout) and `sleep`
 * are left out.
 */
const SHELL_TOOLS: ReadonlySet<string> = new Set([
	"awk",
	"base64",
	"basename",
	"cat",
	"cd",
	"chmod",
	"column",
	"comm",
	"cp",
	"cut",
	"date",
	"diff",
	"dirname",
	"du",
	"echo",
	"expand",
	"expr",
	"file",
	"find",
	"fold",
	"grep",
	"gzip",
	"head",
	"hostname",
	"jq",
	"join",
	"ln",
	"ls",
	"md5sum",
	"mkdir",
	"mv",
	"nl",
	"od",
	"paste",
	"printf",
	"pwd",
	"readlink",
	"rev",
	"rg",
	"rm",
	"rmdir",
	"sed",
	"seq",
	"sort",
	"split",
	"stat",
	"strings",
	"tac",
	"tail",
	"tar",
	"tee",
	"touch",
	"tr",
	"tree",
	"true",
	"uniq",
	"wc",
	"which",
	"whoami",
	"yq",
]);

/** A substitution (`$(node app.js)`) could start anything. */
const SUBSTITUTION = /`|\$\(/;

/** Whether every part of this command line is one of the shell's own tools. */
export const usesOnlyShellTools = (command: string): boolean => {
	if (SUBSTITUTION.test(command)) return false;
	const stages = splitChain(command).flatMap((segment) =>
		splitPipeline(segment.text),
	);
	return (
		stages.length > 0 &&
		stages.every((stage) => {
			const name = parseSegment(stage).argv[0];
			return name !== undefined && SHELL_TOOLS.has(name);
		})
	);
};

/**
 * Whether this command line may run next to a running command: host
 * commands run outside the shell, and the shell's own tools leave the
 * running command's stdin and output alone.
 */
export const runsAlongside = (command: string): boolean =>
	usesHostCommand(command) || usesOnlyShellTools(command);
