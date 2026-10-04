/**
 * What pi reads from disk at startup, read from the Memon file system:
 * AGENTS.md / CLAUDE.md context files (agent dir, then cwd and its parents),
 * SYSTEM.md / APPEND_SYSTEM.md, and skills (folders with a SKILL.md, or .md
 * files at the top of a skills folder). Same places and rules as pi's
 * resource loader, with ~/.pi/agent being <Memon home>/.pi/agent.
 */
import { parse as parseYaml } from "yaml";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { SessionResources } from "../coding-agent/core/agent-session";
import type { Skill } from "../coding-agent/core/skills";
import { basename, dirname, join, resolve } from "../platform/path";

const CONTEXT_FILE_NAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
/** pi's project config folder (CONFIG_DIR_NAME). */
export const PI_CONFIG_DIR = ".pi";

type ReadText = (path: string) => Promise<string | undefined>;

async function loadContextFileFromDir(
	dir: string,
	readText: ReadText,
): Promise<{ path: string; content: string } | null> {
	for (const name of CONTEXT_FILE_NAMES) {
		const path = join(dir, name);
		const content = await readText(path);
		if (content !== undefined) return { path, content };
	}
	return null;
}

/** pi's loadProjectContextFiles: the agent dir's file, then root → cwd. */
async function loadProjectContextFiles(
	cwd: string,
	agentDir: string,
	readText: ReadText,
) {
	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const globalContext = await loadContextFileFromDir(agentDir, readText);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorContextFiles: Array<{ path: string; content: string }> = [];
	let currentDir = resolve(cwd);
	while (true) {
		const contextFile = await loadContextFileFromDir(currentDir, readText);
		if (contextFile && !seenPaths.has(contextFile.path)) {
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	contextFiles.push(...ancestorContextFiles);
	return contextFiles;
}

/** The YAML frontmatter of a markdown file, or {} when there is none. */
function parseFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	try {
		const parsed = parseYaml(match[1]) as unknown;
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function skillFromFile(
	filePath: string,
	content: string,
	fallbackName: string,
): Skill | null {
	const frontmatter = parseFrontmatter(content);
	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description.trim()
			: "";
	// Agent Skills spec: a skill without a description is not loaded.
	if (!description) return null;
	const name =
		typeof frontmatter.name === "string" && frontmatter.name.trim()
			? frontmatter.name.trim()
			: fallbackName;
	return {
		name,
		description,
		filePath,
		baseDir: dirname(filePath),
		disableModelInvocation: frontmatter["disable-model-invocation"] === true,
	};
}

/**
 * pi's skill discovery: a folder with SKILL.md is a skill (no deeper search),
 * .md files directly in the skills root are skills, other folders are searched.
 */
async function loadSkillsFromDir(
	fs: IFlowFileSystem,
	dir: string,
	includeRootFiles: boolean,
): Promise<Skill[]> {
	let entries: Awaited<ReturnType<IFlowFileSystem["readdir"]>>;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const read = (path: string) =>
		fs.readFile(path, { encoding: "utf8" }).catch(() => undefined);

	const skillFile = entries.find(
		(entry) => entry.name === "SKILL.md" && !entry.isDirectory(),
	);
	if (skillFile) {
		const path = join(dir, skillFile.name);
		const content = await read(path);
		const skill =
			content === undefined
				? null
				: skillFromFile(path, content, basename(dir));
		return skill ? [skill] : [];
	}

	const skills: Skill[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			skills.push(...(await loadSkillsFromDir(fs, path, false)));
		} else if (includeRootFiles && entry.name.endsWith(".md")) {
			const content = await read(path);
			const skill =
				content === undefined
					? null
					: skillFromFile(path, content, entry.name.replace(/\.md$/, ""));
			if (skill) skills.push(skill);
		}
	}
	return skills;
}

export async function loadSessionResources(
	fs: IFlowFileSystem,
	options: { cwd: string; agentDir: string; environmentNote: string },
	readText: ReadText,
): Promise<SessionResources> {
	const { cwd, agentDir } = options;
	const [
		contextFiles,
		projectSystem,
		globalSystem,
		projectAppend,
		globalAppend,
		userSkills,
		projectSkills,
	] = await Promise.all([
		loadProjectContextFiles(cwd, agentDir, readText),
		readText(join(cwd, PI_CONFIG_DIR, "SYSTEM.md")),
		readText(join(agentDir, "SYSTEM.md")),
		readText(join(cwd, PI_CONFIG_DIR, "APPEND_SYSTEM.md")),
		readText(join(agentDir, "APPEND_SYSTEM.md")),
		loadSkillsFromDir(fs, join(agentDir, "skills"), true),
		loadSkillsFromDir(fs, join(cwd, PI_CONFIG_DIR, "skills"), true),
	]);

	// Project skills win over user skills with the same name.
	const skillsByName = new Map<string, Skill>();
	for (const skill of [...userSkills, ...projectSkills])
		skillsByName.set(skill.name, skill);

	const append = projectAppend ?? globalAppend;
	return {
		contextFiles,
		skills: [...skillsByName.values()],
		customPrompt: projectSystem ?? globalSystem,
		appendSystemPrompt: [options.environmentNote, ...(append ? [append] : [])],
	};
}
