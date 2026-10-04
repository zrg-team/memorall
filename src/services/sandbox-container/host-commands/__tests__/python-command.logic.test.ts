import { describe, expect, it, vi } from "vitest";
import {
	importedModules,
	runPip,
	runPython,
	runUnzip,
	runZip,
} from "../python-command";
import type { HostCommandContext } from "../types";

const encode = (text: string) => new TextEncoder().encode(text);

const createContext = (existing: Record<string, string>) => {
	const written = new Map<string, Uint8Array | string>();
	const removed: string[] = [];
	const context: HostCommandContext = {
		cwd: "/work",
		env: {},
		files: {
			isDirectory: async () => true,
			exists: async (path) => path in existing,
			walk: async () => ({
				files: Object.keys(existing).map((path) => ({ path, size: 1 })),
				truncated: false,
			}),
			read: async (path) => encode(existing[path]),
			write: async (path, data) => {
				written.set(path, data);
			},
			append: async () => undefined,
			remove: async (path) => {
				removed.push(path);
			},
		},
		runPython: vi.fn(async () => ({
			exitCode: 0,
			stdout: "4\n",
			stderr: "",
			changed: [{ path: "/work/out.csv", data: encode("a,b\n") }],
			deleted: ["/work/old.txt"],
		})),
		filesChanged: vi.fn(),
	};
	return { context, written, removed };
};

describe("py", () => {
	it("runs a script with the working folder's files and keeps what it wrote", async () => {
		const { context, written, removed } = createContext({
			"/work/main.py": "print(2 + 2)",
			"/work/old.txt": "old",
		});

		const result = await runPython(["py", "main.py", "--fast"], context);

		expect(result).toEqual({ stdout: "4\n", stderr: "", exitCode: 0 });
		expect(context.runPython).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "file",
				target: "/work/main.py",
				argv: ["/work/main.py", "--fast"],
				cwd: "/work",
				files: expect.arrayContaining([
					{ path: "/work/main.py", data: encode("print(2 + 2)") },
				]),
			}),
		);
		expect(written.get("/work/out.csv")).toEqual(encode("a,b\n"));
		expect(removed).toEqual(["/work/old.txt"]);
		expect(context.filesChanged).toHaveBeenCalled();
	});

	it("passes -c code through as code", async () => {
		const { context } = createContext({});
		await runPython(["python3", "-c", "print(1)"], context);
		expect(context.runPython).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "code",
				target: "print(1)",
				argv: ["-c"],
			}),
		);
	});

	it("explains what it cannot do", async () => {
		const { context } = createContext({});
		expect((await runPython(["py"], context)).stderr).toContain(
			"interactive Python is not available",
		);
		expect(
			(await runPython(["py", "-m", "pip", "install", "x"], context)).stderr,
		).toContain("cannot install x");
		const missing = await runPython(["py", "nope.py"], context);
		expect(missing.exitCode).toBe(2);
		expect(missing.stderr).toContain("can't open file 'nope.py'");
		expect(context.runPython).not.toHaveBeenCalled();
	});

	it("says what is available when a script imports something that is not", async () => {
		const { context } = createContext({ "/work/fit.py": "import torch" });
		vi.mocked(context.runPython).mockResolvedValueOnce({
			exitCode: 1,
			stdout: "",
			stderr:
				"Traceback (most recent call last):\nModuleNotFoundError: No module named 'torch'\n",
			changed: [],
			deleted: [],
		});

		const result = await runPython(["py", "fit.py"], context);

		expect(result.stderr).toContain("No module named 'torch'");
		expect(result.stderr).toContain(
			"py: no module 'torch': only the standard library and data (numpy, pandas, scipy), charts (matplotlib, plotly, altair, svgwrite)",
		);
	});

	it("says the same when pandas misses an optional reader", async () => {
		const { context } = createContext({ "/work/read.py": "import pandas" });
		vi.mocked(context.runPython).mockResolvedValueOnce({
			exitCode: 1,
			stdout: "",
			stderr:
				"ImportError: Missing optional dependency 'openpyxl'.  Use pip or conda to install openpyxl.\n",
			changed: [],
			deleted: [],
		});

		const result = await runPython(["py", "read.py"], context);

		expect(result.stderr).toContain("py: no module 'openpyxl':");
		expect(result.stderr).toContain("Excel (openpyxl, python_calamine)");
	});
});

describe("pip", () => {
	it("lets an install of a bundled package go on, without installing anything", async () => {
		const { context } = createContext({});
		const result = await runPip(
			["pip", "install", "-q", "numpy", "pandas>=2"],
			context,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			"Requirement already satisfied: numpy (bundled with py)\nRequirement already satisfied: pandas (bundled with py)\n",
		);
		expect(context.runPython).not.toHaveBeenCalled();
	});

	it("refuses anything else and lists what there is", async () => {
		const { context } = createContext({});
		const refused = await runPip(
			["pip3", "install", "torch", "numpy"],
			context,
		);
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain("pip: cannot install torch");
		expect(refused.stderr).toContain("Excel (openpyxl, python_calamine)");

		// Names as pip spells them, in either spelling.
		expect(
			(await runPip(["pip", "install", "Pillow", "python_calamine"], context))
				.exitCode,
		).toBe(0);

		const listed = await runPip(["pip", "list"], context);
		expect(listed.stdout.trim().split("\n")).toEqual([
			"numpy",
			"pandas",
			"matplotlib",
			"altair",
			"svgwrite",
			"pillow",
			"pypdf",
			"fpdf2",
			"python-docx",
			"python-pptx",
			"openpyxl",
			"python-calamine",
			"soundfile",
			"tree-sitter",
			"tree-sitter-python",
			"tree-sitter-java",
			"tree-sitter-go",
			"rank-bm25",
			"rdflib",
			"zengl",
			"sqlite3",
			"plotly",
			"jinja2",
			"faker",
			"pdfminer.six",
			"scikit-image",
			"scipy",
			"networkx",
			"mammoth",
			"pymupdf",
			"lzma",
		]);
	});
});

describe("how a package works here", () => {
	it("pip show prints the usage note, by pip name or import name", async () => {
		const { context } = createContext({});
		const zengl = await runPip(["pip", "show", "zengl"], context);
		expect(zengl.exitCode).toBe(0);
		expect(zengl.stdout).toContain("Name: zengl");
		expect(zengl.stdout).toContain(
			"Here: zengl.init() and zengl.context() take no arguments",
		);

		const fpdf = await runPip(["pip", "show", "fpdf"], context);
		expect(fpdf.stdout).toContain("Name: fpdf2");
		expect(fpdf.stdout).toContain("DejaVuSans.ttf");

		// Bundled without anything special to say, and not bundled at all.
		const mixed = await runPip(["pip", "show", "numpy", "torch"], context);
		expect(mixed.stdout).toBe("Name: numpy\nLocation: bundled with py\n");
		expect(mixed.stderr).toBe("WARNING: Package(s) not found: torch\n");
		expect(mixed.exitCode).toBe(1);
	});

	it("puts the note next to the error when a script using the package fails", async () => {
		const { context } = createContext({
			"/work/render.py":
				"import zengl\nfrom PIL import Image\nzengl.init(size=(64, 64))\n",
		});
		vi.mocked(context.runPython).mockResolvedValueOnce({
			exitCode: 1,
			stdout: "",
			stderr: "TypeError: init() got an unexpected keyword argument 'size'\n",
			changed: [],
			deleted: [],
		});

		const result = await runPython(["py", "render.py"], context);

		expect(result.stderr).toContain("unexpected keyword argument 'size'");
		expect(result.stderr).toContain(
			"py: zengl here: zengl.init() and zengl.context() take no arguments",
		);
		// Only for what the script imported, and only when it failed.
		expect(result.stderr).not.toContain("altair here");
		expect((await runPython(["py", "render.py"], context)).stderr).toBe("");
	});

	it("reads a script's top-level imports", () => {
		expect([
			...importedModules(
				"import os, numpy as np\nfrom PIL import Image\n  import zengl.extra\n# import nope\nx = 'import fake'\n",
			),
		]).toEqual(["os", "numpy", "PIL", "zengl"]);
	});
});

describe("zip and unzip", () => {
	it("zip packs files and folders through Python's zipfile", async () => {
		const { context } = createContext({ "/work/a.txt": "a" });
		await runZip(["zip", "-r", "-q", "out", "a.txt", "docs"], context);
		expect(context.runPython).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "module",
				target: "zipfile",
				argv: ["zipfile", "-c", "out.zip", "a.txt", "docs"],
			}),
		);
	});

	it("unzip extracts where asked, or lists", async () => {
		const { context } = createContext({ "/work/a.zip": "zip" });
		await runUnzip(["unzip", "-o", "a.zip", "-d", "dest"], context);
		expect(context.runPython).toHaveBeenLastCalledWith(
			expect.objectContaining({ argv: ["zipfile", "-e", "a.zip", "dest"] }),
		);
		await runUnzip(["unzip", "a.zip"], context);
		expect(context.runPython).toHaveBeenLastCalledWith(
			expect.objectContaining({ argv: ["zipfile", "-e", "a.zip", "."] }),
		);
		await runUnzip(["unzip", "-l", "a.zip"], context);
		expect(context.runPython).toHaveBeenLastCalledWith(
			expect.objectContaining({ argv: ["zipfile", "-l", "a.zip"] }),
		);
	});

	it("says how to use them when the arguments are missing", async () => {
		const { context } = createContext({});
		expect((await runZip(["zip", "-r", "out.zip"], context)).stderr).toContain(
			"usage: zip",
		);
		expect((await runUnzip(["unzip", "-d"], context)).stderr).toContain(
			"usage: unzip",
		);
		expect(context.runPython).not.toHaveBeenCalled();
	});
});
