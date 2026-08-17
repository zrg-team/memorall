import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory filesystem standing in for ZenFS
// ---------------------------------------------------------------------------

type Node = { type: "dir" } | { type: "file"; data: Uint8Array };

const nodes = new Map<string, Node>();

const fsError = (code: string, path: string) =>
	Object.assign(new Error(`${code}: ${path}`), { code });

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

const fakeFs = {
	promises: {
		async mkdir(path: string) {
			if (nodes.has(path)) throw fsError("EEXIST", path);
			nodes.set(path, { type: "dir" });
		},
		async stat(path: string) {
			const node = nodes.get(path);
			if (!node) throw fsError("ENOENT", path);
			return {
				isDirectory: () => node.type === "dir",
				isFile: () => node.type === "file",
			};
		},
		async readdir(path: string) {
			const node = nodes.get(path);
			if (!node) throw fsError("ENOENT", path);
			const prefix = `${path}/`;
			const children = new Set<string>();
			for (const key of nodes.keys()) {
				if (!key.startsWith(prefix)) continue;
				children.add(key.slice(prefix.length).split("/")[0]);
			}
			return [...children];
		},
		async readFile(path: string) {
			const node = nodes.get(path);
			if (!node || node.type !== "file") throw fsError("ENOENT", path);
			return node.data;
		},
		async writeFile(path: string, data: Uint8Array) {
			nodes.set(path, { type: "file", data });
		},
		async unlink(path: string) {
			if (!nodes.has(path)) throw fsError("ENOENT", path);
			nodes.delete(path);
		},
		async rmdir(path: string) {
			nodes.delete(path);
		},
		async rename(from: string, to: string) {
			const node = nodes.get(from);
			if (!node) throw fsError("ENOENT", from);
			nodes.set(to, node);
			nodes.delete(from);
			// Move descendants too, so renaming a directory moves its contents.
			for (const [key, value] of [...nodes.entries()]) {
				if (!key.startsWith(`${from}/`)) continue;
				nodes.set(`${to}${key.slice(from.length)}`, value);
				nodes.delete(key);
			}
		},
	},
};

vi.mock("@/services/filesystem/fs", () => ({
	default: fakeFs,
	initializeFs: async () => undefined,
}));

const DEFAULT_SKILL = {
	name: "bundled-default",
	description: "A bundled skill",
	path: "/skills/default/bundled-default.md",
	publisher: "anthropic",
	collection: "document-skills",
	repo: "anthropic/skills",
	sourceUrl: "https://example.test/skill",
	origin: "default" as const,
	readOnly: true as const,
	format: "file" as const,
	author: "anthropic",
	tags: ["document-skills"],
};

vi.mock("@/services/filesystem/default-skills", () => ({
	listDefaultSkills: () => [DEFAULT_SKILL],
	readDefaultSkill: async (name: string) =>
		name === DEFAULT_SKILL.name
			? { ...DEFAULT_SKILL, body: "default body" }
			: null,
}));

const store = new Map<string, unknown>();
vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: async (key: string) => store.get(key),
			set: async (key: string, value: unknown) => void store.set(key, value),
		},
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: () => undefined,
	logInfo: () => undefined,
	logDebug: () => undefined,
}));

const SKILLS_ROOT = "/home/skills";
const LEGACY_ROOT = "/home/files/skills";

const loadService = async () => {
	const module = await import("../skill-filesystem");
	return module;
};

const seedFile = (path: string, content: string) => {
	nodes.set(path, { type: "file", data: encode(content) });
};

const seedDir = (path: string) => nodes.set(path, { type: "dir" });

const readText = (path: string) => {
	const node = nodes.get(path);
	if (!node || node.type !== "file") throw new Error(`missing file ${path}`);
	return decode(node.data);
};

beforeEach(() => {
	nodes.clear();
	store.clear();
	vi.resetModules();
});

// ---------------------------------------------------------------------------

describe("frontmatter", () => {
	it("reads inline lists, block lists and quoted scalars", async () => {
		const { parseFrontmatter } = await loadService();

		const inline = parseFrontmatter(
			`---\nname: a\ntags: [alpha, "beta, gamma"]\n---\n\nbody`,
		);
		expect(inline.meta.tags).toEqual(["alpha", "beta, gamma"]);
		expect(inline.body).toBe("body");

		const block = parseFrontmatter(
			`---\nname: a\ntags:\n  - alpha\n  - beta\n---\n\nbody`,
		);
		expect(block.meta.tags).toEqual(["alpha", "beta"]);

		const quoted = parseFrontmatter(
			`---\nname: a\ndescription: "Use when: reading PDFs"\n---\n\nbody`,
		);
		expect(quoted.meta.description).toBe("Use when: reading PDFs");
	});

	it("treats a valueless key as an empty scalar, not an empty list", async () => {
		const { parseFrontmatter } = await loadService();
		const parsed = parseFrontmatter(`---\nname: a\ndescription:\n---\n\nbody`);
		expect(parsed.meta.description).toBe("");
	});

	it("returns the whole document as body when there is no frontmatter", async () => {
		const { parseFrontmatter } = await loadService();
		const parsed = parseFrontmatter("# Just markdown");
		expect(parsed.meta).toEqual({});
		expect(parsed.body).toBe("# Just markdown");
	});
});

describe("validateSkillName", () => {
	it("accepts standard names and rejects the rest", async () => {
		const { validateSkillName } = await loadService();
		expect(validateSkillName("pdf-processing").valid).toBe(true);
		expect(validateSkillName("skill1").valid).toBe(true);
		expect(validateSkillName("").valid).toBe(false);
		expect(validateSkillName("Has Caps").valid).toBe(false);
		expect(validateSkillName("-leading").valid).toBe(false);
		expect(validateSkillName("a".repeat(65)).valid).toBe(false);
	});
});

describe("listSkills", () => {
	it("resolves file skills, folder skills, and skips directories without SKILL.md", async () => {
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/note-taking.md`,
			`---\nname: note-taking\ndescription: Takes notes\n---\n\nbody`,
		);
		seedDir(`${SKILLS_ROOT}/research-kit`);
		seedFile(
			`${SKILLS_ROOT}/research-kit/SKILL.md`,
			`---\nname: research-kit\ndescription: Researches\n---\n\nbody`,
		);
		seedDir(`${SKILLS_ROOT}/not-a-skill`);
		seedFile(`${SKILLS_ROOT}/not-a-skill/readme.md`, "nothing");

		const { skillFileSystemService } = await loadService();
		const skills = await skillFileSystemService.listSkills();
		const byName = new Map(skills.map((skill) => [skill.name, skill]));

		expect(byName.get("note-taking")?.format).toBe("file");
		expect(byName.get("research-kit")?.format).toBe("folder");
		expect(byName.has("not-a-skill")).toBe(false);
		// Bundled defaults still merge in.
		expect(byName.has("bundled-default")).toBe(true);
	});

	it("lets a custom skill shadow a bundled default of the same name", async () => {
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/bundled-default.md`,
			`---\nname: bundled-default\ndescription: Mine\n---\n\nbody`,
		);

		const { skillFileSystemService } = await loadService();
		const skills = await skillFileSystemService.listSkills();
		const match = skills.filter((skill) => skill.name === "bundled-default");

		expect(match).toHaveLength(1);
		expect(match[0].origin).toBe("custom");
		expect(match[0].description).toBe("Mine");
	});
});

describe("writeSkill", () => {
	it("preserves frontmatter keys it does not model", async () => {
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/kept.md`,
			`---\nname: kept\ndescription: old\nversion: 1.2.0\nlicense: MIT\ntags: [alpha, beta]\n---\n\nold body`,
		);

		const { skillFileSystemService } = await loadService();
		await skillFileSystemService.writeSkill("kept", "new", "new body");

		const written = readText(`${SKILLS_ROOT}/kept.md`);
		expect(written).toContain("description: new");
		expect(written).toContain("version: 1.2.0");
		expect(written).toContain("license: MIT");
		expect(written).toContain("tags: [alpha, beta]");
		expect(written).toContain("new body");

		const reread = await skillFileSystemService.readSkill("kept");
		expect(reread.version).toBe("1.2.0");
		expect(reread.tags).toEqual(["alpha", "beta"]);
		expect(reread.body).toBe("new body");
	});

	it("writes back into the folder shape when the skill is a folder", async () => {
		seedDir(SKILLS_ROOT);
		seedDir(`${SKILLS_ROOT}/bundle`);
		seedFile(
			`${SKILLS_ROOT}/bundle/SKILL.md`,
			`---\nname: bundle\ndescription: old\n---\n\nold`,
		);

		const { skillFileSystemService } = await loadService();
		const saved = await skillFileSystemService.writeSkill(
			"bundle",
			"new",
			"new body",
		);

		expect(saved.format).toBe("folder");
		expect(readText(`${SKILLS_ROOT}/bundle/SKILL.md`)).toContain("new body");
		expect(nodes.has(`${SKILLS_ROOT}/bundle.md`)).toBe(false);
	});

	it("rejects a name that is not standard-conformant", async () => {
		seedDir(SKILLS_ROOT);
		const { skillFileSystemService } = await loadService();
		await expect(
			skillFileSystemService.writeSkill("!!!", "desc", "body"),
		).rejects.toThrow();
	});
});

describe("resources and auto-promotion", () => {
	it("promotes a file skill to a folder when its first resource is written", async () => {
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/kit.md`,
			`---\nname: kit\ndescription: A kit\n---\n\nbody`,
		);

		const { skillFileSystemService } = await loadService();
		await skillFileSystemService.writeSkillResource(
			"kit",
			"references/api.md",
			encode("# API"),
		);

		expect(nodes.has(`${SKILLS_ROOT}/kit.md`)).toBe(false);
		expect(readText(`${SKILLS_ROOT}/kit/SKILL.md`)).toContain("body");
		expect(readText(`${SKILLS_ROOT}/kit/references/api.md`)).toBe("# API");

		const resources = await skillFileSystemService.listSkillResources("kit");
		expect(resources).toEqual([
			{ path: "references/api.md", name: "api.md", kind: "markdown" },
		]);

		const skill = await skillFileSystemService.readSkill("kit");
		expect(skill.format).toBe("folder");
		expect(skill.body).toBe("body");
	});

	it("refuses resource paths that escape the skill directory", async () => {
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/kit.md`,
			`---\nname: kit\ndescription: d\n---\n\nb`,
		);

		const { skillFileSystemService } = await loadService();
		await expect(
			skillFileSystemService.writeSkillResource(
				"kit",
				"../escape.md",
				encode("x"),
			),
		).rejects.toThrow(/Invalid resource path/);
	});

	it("deletes a folder skill and everything inside it", async () => {
		seedDir(SKILLS_ROOT);
		seedDir(`${SKILLS_ROOT}/kit`);
		seedDir(`${SKILLS_ROOT}/kit/references`);
		seedFile(
			`${SKILLS_ROOT}/kit/SKILL.md`,
			`---\nname: kit\ndescription: d\n---\n\nb`,
		);
		seedFile(`${SKILLS_ROOT}/kit/references/api.md`, "# API");

		const { skillFileSystemService } = await loadService();
		await skillFileSystemService.deleteSkill("kit");

		expect([...nodes.keys()].filter((key) => key.includes("/kit"))).toEqual([]);
	});
});

describe("legacy root migration", () => {
	it("moves skills off the documents mount and clears the old root", async () => {
		seedDir(LEGACY_ROOT);
		seedFile(
			`${LEGACY_ROOT}/old-skill.md`,
			`---\nname: old-skill\ndescription: Legacy\n---\n\nbody`,
		);
		seedDir(`${LEGACY_ROOT}/old-bundle`);
		seedFile(
			`${LEGACY_ROOT}/old-bundle/SKILL.md`,
			`---\nname: old-bundle\ndescription: Legacy bundle\n---\n\nbody`,
		);

		const { skillFileSystemService } = await loadService();
		const skills = await skillFileSystemService.listSkills();
		const names = skills.map((skill) => skill.name);

		expect(names).toContain("old-skill");
		expect(names).toContain("old-bundle");
		expect(nodes.has(`${SKILLS_ROOT}/old-skill.md`)).toBe(true);
		expect(nodes.has(`${SKILLS_ROOT}/old-bundle/SKILL.md`)).toBe(true);
		expect(nodes.has(`${LEGACY_ROOT}/old-skill.md`)).toBe(false);
		expect(nodes.has(LEGACY_ROOT)).toBe(false);
	});

	it("keeps the destination copy on a name collision", async () => {
		seedDir(LEGACY_ROOT);
		seedFile(
			`${LEGACY_ROOT}/dup.md`,
			`---\nname: dup\ndescription: legacy copy\n---\n\nlegacy`,
		);
		seedDir(SKILLS_ROOT);
		seedFile(
			`${SKILLS_ROOT}/dup.md`,
			`---\nname: dup\ndescription: current copy\n---\n\ncurrent`,
		);

		const { skillFileSystemService } = await loadService();
		const skill = await skillFileSystemService.readSkill("dup");

		expect(skill.description).toBe("current copy");
		expect(skill.body).toBe("current");
	});

	it("is a no-op on the second run", async () => {
		seedDir(LEGACY_ROOT);
		seedFile(
			`${LEGACY_ROOT}/once.md`,
			`---\nname: once\ndescription: d\n---\n\nbody`,
		);

		const first = await loadService();
		await first.skillFileSystemService.listSkills();
		expect(store.get("memorall.filesystem.skillsRoot.v1")).toBe(true);

		// A stray legacy file appearing later must not be re-migrated silently.
		seedDir(LEGACY_ROOT);
		seedFile(
			`${LEGACY_ROOT}/stray.md`,
			`---\nname: stray\ndescription: d\n---\n\nb`,
		);

		vi.resetModules();
		const second = await loadService();
		const names = (await second.skillFileSystemService.listSkills()).map(
			(skill) => skill.name,
		);

		expect(names).toContain("once");
		expect(names).not.toContain("stray");
	});

	it("marks itself complete when there is no legacy root at all", async () => {
		const { skillFileSystemService } = await loadService();
		await skillFileSystemService.listSkills();
		expect(store.get("memorall.filesystem.skillsRoot.v1")).toBe(true);
	});
});

describe("planFolderImport", () => {
	const fileFrom = (relPath: string, content: string): File => {
		const file = new File([content], relPath.split("/").pop()!, {
			type: "text/markdown",
		});
		Object.defineProperty(file, "webkitRelativePath", { value: relPath });
		return file;
	};

	it("groups a SKILL.md subtree into one folder skill and keeps loose files separate", async () => {
		const { skillFileSystemService } = await loadService();

		const candidates = await skillFileSystemService.planFolderImport([
			fileFrom(
				"skills/research-kit/SKILL.md",
				`---\nname: research-kit\ndescription: Researches\n---\n\nbody`,
			),
			fileFrom("skills/research-kit/references/api.md", "# API"),
			fileFrom(
				"skills/standalone.md",
				`---\nname: standalone\ndescription: Alone\n---\n\nbody`,
			),
		]);

		const bundle = candidates.find((c) => c.name === "research-kit");
		expect(bundle?.format).toBe("folder");
		expect(bundle?.resources.map((r) => r.path)).toEqual(["references/api.md"]);

		const loose = candidates.find((c) => c.name === "standalone");
		expect(loose?.format).toBe("file");
		expect(loose?.resources).toEqual([]);
	});

	it("warns when a candidate has no description", async () => {
		const { skillFileSystemService } = await loadService();
		const [candidate] = await skillFileSystemService.planFolderImport([
			fileFrom("skills/no-desc.md", `---\nname: no-desc\n---\n\nbody`),
		]);

		expect(candidate.errors).toEqual([]);
		expect(candidate.warnings.join(" ")).toMatch(/description/);
	});

	it("commits a reviewed folder candidate with its resources", async () => {
		seedDir(SKILLS_ROOT);
		const { skillFileSystemService } = await loadService();

		const candidates = await skillFileSystemService.planFolderImport([
			fileFrom(
				"skills/kit/SKILL.md",
				`---\nname: kit\ndescription: A kit\n---\n\nbody`,
			),
			fileFrom("skills/kit/references/api.md", "# API"),
		]);
		await skillFileSystemService.commitImport(candidates[0]);

		expect(readText(`${SKILLS_ROOT}/kit/SKILL.md`)).toContain("body");
		expect(readText(`${SKILLS_ROOT}/kit/references/api.md`)).toBe("# API");
	});
});
