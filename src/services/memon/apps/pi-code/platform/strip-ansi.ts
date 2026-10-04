/**
 * Remove ANSI escape sequences, like the strip-ansi package pi uses. The
 * pattern is ansi-regex's (MIT, Sindre Sorhus): CSI/OSC sequences terminated
 * by BEL, ST or a final byte.
 */
const ANSI_PATTERN = new RegExp(
	[
		"[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))",
		"(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
	].join("|"),
	"g",
);

export default function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}
