import { describe, expect, it } from "vitest";
import { runsAlongside, usesOnlyShellTools } from "../alongside-commands";

describe("alongside commands", () => {
	it("takes only lines made of the shell's own tools", () => {
		expect(usesOnlyShellTools("ls -la")).toBe(true);
		expect(usesOnlyShellTools("cd src && cat a.txt | grep x > out.txt")).toBe(
			true,
		);
		expect(usesOnlyShellTools("node server.js")).toBe(false);
		expect(usesOnlyShellTools("ls && npm test")).toBe(false);
		expect(usesOnlyShellTools("ls | xargs node")).toBe(false);
		expect(usesOnlyShellTools("")).toBe(false);
	});

	it("refuses a substitution, which could start node", () => {
		expect(usesOnlyShellTools("echo $(node a.js)")).toBe(false);
		expect(usesOnlyShellTools("echo `node a.js`")).toBe(false);
	});

	it("lets host commands run next to a running one too", () => {
		expect(runsAlongside("curl -s localhost:3000")).toBe(true);
		expect(runsAlongside("git status")).toBe(true);
		expect(runsAlongside("mkdir -p dist")).toBe(true);
		expect(runsAlongside("npx vite")).toBe(false);
	});
});
