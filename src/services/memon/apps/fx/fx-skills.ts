/**
 * The agent's Memorall skills, for fx.
 *
 * fx's own skill loader needs a file system its WebAssembly build does not
 * have, so Memorall hands fx the skills the agent has turned on the way fx
 * uses skills anyway: their names and descriptions up front, in the home
 * AGENTS.md, and each one's full instructions in a SKILL.md under
 * ~/.fx/skills that fx reads with its shell when a task calls for it.
 */

import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { MemonSkillsPort } from "../../memon-machine";
import { memonEnvironmentNote } from "../environment-note";
import { fxDir } from "./fx-stores";

/** A skill fx was given: where its instructions are. */
export interface FxSkillEntry {
	name: string;
	description: string;
	path: string;
}

/** A description longer than this is cut in the catalog; the file keeps all of it. */
const MAX_DESCRIPTION_CHARS = 300;

export const fxSkillsDir = (home: string): string => `${fxDir(home)}/skills`;

/** A skill name as a folder name: what a skill name already allows. */
const folderOf = (name: string): string => name.replace(/[^\w.-]/g, "-");

const frontmatterValue = (value: string): string => JSON.stringify(value);

/**
 * Writes the skills the agent has turned on into ~/.fx/skills, removes the
 * ones it turned off since, and returns what was written. A skill that cannot
 * be read (a built-in one offline) is left out.
 */
export const installFxSkills = async (
	fs: IFlowFileSystem,
	home: string,
	skills: Pick<MemonSkillsPort, "list" | "read">,
	agentId: string | null,
): Promise<FxSkillEntry[]> => {
	const dir = fxSkillsDir(home);
	const { items } = await skills.list(agentId);
	const enabled = items.filter((item) => item.enabled);
	const written = await Promise.all(
		enabled.map(async (item): Promise<FxSkillEntry | null> => {
			const skill = await skills.read(item.name).catch(() => null);
			if (!skill) return null;
			const folder = `${dir}/${folderOf(skill.name)}`;
			const path = `${folder}/SKILL.md`;
			await fs.mkdir(folder, { recursive: true });
			await fs.writeFile(
				path,
				[
					"---",
					`name: ${frontmatterValue(skill.name)}`,
					`description: ${frontmatterValue(skill.description)}`,
					"---",
					"",
					skill.body.trim(),
					"",
				].join("\n"),
			);
			return { name: skill.name, description: skill.description, path };
		}),
	);
	const entries = written.filter(
		(entry): entry is FxSkillEntry => entry !== null,
	);

	const keep = new Set(entries.map((entry) => folderOf(entry.name)));
	const present = await fs.readdir(dir).catch(() => [] as string[]);
	await Promise.all(
		present
			.filter((name) => !keep.has(name))
			.map((name) =>
				fs
					.rm(`${dir}/${name}`, { recursive: true, force: true })
					.catch(() => {}),
			),
	);
	return entries;
};

const oneLine = (text: string): string => {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > MAX_DESCRIPTION_CHARS
		? `${line.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
		: line;
};

/** What Memorall tells fx in its home AGENTS.md. */
export const fxInstructions = (skills: FxSkillEntry[]): string => {
	const sections = [
		"# MemonOS",
		"",
		memonEnvironmentNote("shell"),
		"- The shell tool's own description is written for a bare browser shell. Here its commands run in the sandbox above, so Node.js, npm, git and python are there: use them.",
		"- Model calls go through Memorall: the model the user chose in Memorall answers. /model lists the models of that provider.",
	];
	if (skills.length) {
		sections.push(
			"",
			"# Skills",
			"",
			"The user's Memorall skills this agent has turned on. Each is a SKILL.md with instructions for one kind of task. When a task matches a skill's description, read the whole file with `cat` before you start, and follow it.",
			"",
			...skills.map(
				(skill) =>
					`- ${skill.name}: ${oneLine(skill.description)} (${skill.path})`,
			),
		);
	}
	return sections.join("\n");
};
