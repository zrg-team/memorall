import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every model request on a computer must go through the models port, which
 * books it in the model usage ledger; otherwise the Usage page misses it.
 * So no MemonOS code reaches the LLM service any other way.
 */
const ROOTS = [
	"src/services/memon",
	"src/services/flows-integrations/tools/memon",
];
const ALLOWED = new Set(["src/services/memon/models-port.ts"]);
const DIRECT_ACCESS =
	/\bllmService\b|\bgetLLMService\s*\(|LLMService(Main|Proxy)\b/;

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : sourceFiles(path);
		}
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});

describe("MemonOS model access", () => {
	it("reaches the models only through the metered models port", () => {
		const files = ROOTS.flatMap((root) => sourceFiles(root));
		expect(files.length).toBeGreaterThan(20);
		const offenders = files
			.map((file) => relative(process.cwd(), file).split(sep).join("/"))
			.filter((file) => !ALLOWED.has(file))
			.filter((file) => DIRECT_ACCESS.test(readFileSync(file, "utf8")));
		expect(offenders).toEqual([]);
	});
});
