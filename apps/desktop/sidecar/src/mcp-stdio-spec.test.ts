import { describe, expect, it } from "vitest";
import { parseStdioSpec, stdioFingerprint } from "./mcp-stdio-spec";

const absolute = process.platform === "win32" ? "C:\\work" : "/work";

describe("parseStdioSpec", () => {
	it("accepts a complete spec and fills defaults", () => {
		expect(parseStdioSpec({ id: "c1", command: "npx" })).toEqual({
			id: "c1",
			command: "npx",
			args: [],
			env: {},
			secretEnvKeys: [],
		});
		expect(
			parseStdioSpec({
				id: "c1",
				command: "uvx",
				args: ["mcp-server-git"],
				cwd: absolute,
				env: { TOKEN: "x" },
				secretEnvKeys: ["TOKEN"],
			}),
		).toMatchObject({ cwd: absolute, env: { TOKEN: "x" } });
	});

	it.each([
		[{ command: "npx" }, "spec.id"],
		[{ id: "c1", command: " " }, "spec.command"],
		[{ id: "c1", command: "npx", args: "x" }, "spec.args"],
		[{ id: "c1", command: "npx", args: [1] }, "spec.args[0]"],
		[{ id: "c1", command: "npx", cwd: "relative" }, "absolute"],
		[{ id: "c1", command: "npx", env: { "BAD-KEY": "x" } }, "BAD-KEY"],
		[{ id: "c1", command: "npx", shell: true }, "unexpected"],
		[{ id: "c1", command: "npx", args: Array(65).fill("a") }, "at most"],
	])("rejects %j", (value, message) => {
		expect(() => parseStdioSpec(value)).toThrow(message);
	});
});

describe("stdioFingerprint", () => {
	const base = parseStdioSpec({
		id: "c1",
		command: "npx",
		args: ["-y", "pkg"],
		env: { B: "2", A: "1" },
	});

	it("ignores env ordering and secret key bookkeeping", () => {
		expect(
			stdioFingerprint({
				...base,
				env: { A: "1", B: "2" },
				secretEnvKeys: ["A"],
			}),
		).toBe(stdioFingerprint(base));
	});

	it("changes when anything that affects the process changes", () => {
		const fingerprint = stdioFingerprint(base);
		expect(stdioFingerprint({ ...base, args: ["-y", "other"] })).not.toBe(
			fingerprint,
		);
		expect(stdioFingerprint({ ...base, env: { A: "1", B: "3" } })).not.toBe(
			fingerprint,
		);
		expect(stdioFingerprint({ ...base, cwd: absolute })).not.toBe(fingerprint);
	});
});
