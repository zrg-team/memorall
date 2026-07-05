import fs from "@/services/filesystem/fs";
import {
	listDefaultSkills,
	readDefaultSkill,
} from "@/services/filesystem/default-skills";
import {
	documentFileSystemService,
	SANDBOX_DOCUMENTS_ROOT,
} from "@/services/filesystem/document-filesystem";
import { logError, logInfo } from "@/utils/logger";

const SKILLS_FS_ROOT = "/home/files/skills";
const SKILLS_SANDBOX_ROOT = `${SANDBOX_DOCUMENTS_ROOT}/skills` as const;

export interface SkillSummary {
	name: string;
	description: string;
	path: string;
	category?: string;
	publisher?: string;
	collection?: string;
	repo?: string;
	sourceUrl?: string;
	origin?: "custom" | "default";
	readOnly?: boolean;
}

export interface Skill extends SkillSummary {
	/** Body content only — frontmatter is stripped */
	body: string;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

interface FrontmatterResult {
	meta: Record<string, string>;
	body: string;
}

function parseFrontmatter(raw: string): FrontmatterResult {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: raw.trim() };

	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx > 0) {
			const key = line.slice(0, colonIdx).trim();
			const value = line.slice(colonIdx + 1).trim();
			if (key) meta[key] = value;
		}
	}

	return { meta, body: match[2].trim() };
}

function buildContent(name: string, description: string, body: string): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

function filenameToName(filename: string): string {
	return filename.replace(/\.md$/i, "");
}

function nameToFilename(name: string): string {
	// Sanitize: lowercase, replace spaces/special chars with hyphens
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-_]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function toRawGithubUrl(url: string): string {
	// Already a raw URL
	if (url.includes("raw.githubusercontent.com")) return url;

	// Convert github.com blob URL to raw
	// https://github.com/user/repo/blob/branch/path → https://raw.githubusercontent.com/user/repo/branch/path
	const match = url.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
	);
	if (match) {
		return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
	}

	throw new Error(
		"Unsupported URL format. Use a GitHub file URL (github.com/.../blob/...) or raw URL (raw.githubusercontent.com).",
	);
}

function rawUrlToName(rawUrl: string): string {
	const parts = rawUrl.split("/");
	const filename = parts[parts.length - 1] ?? "skill";
	return filenameToName(filename);
}

// ---------------------------------------------------------------------------
// SkillFileSystem
// ---------------------------------------------------------------------------

export class SkillFileSystem {
	private static instance: SkillFileSystem;
	private initialized = false;

	private constructor() {}

	static getInstance(): SkillFileSystem {
		if (!SkillFileSystem.instance) {
			SkillFileSystem.instance = new SkillFileSystem();
		}
		return SkillFileSystem.instance;
	}

	private async initialize(): Promise<void> {
		if (this.initialized) return;
		await documentFileSystemService.mkdir(SKILLS_SANDBOX_ROOT);
		this.initialized = true;
	}

	private fsPath(name: string): string {
		return `${SKILLS_FS_ROOT}/${nameToFilename(name)}.md`;
	}

	private sandboxPath(name: string): string {
		return `${SKILLS_SANDBOX_ROOT}/${nameToFilename(name)}.md`;
	}

	/**
	 * List all skills (reads only frontmatter — efficient for large skill sets).
	 */
	async listSkills(): Promise<SkillSummary[]> {
		const defaultSkills = listDefaultSkills();
		const results = new Map<string, SkillSummary>();

		try {
			await this.initialize();
		} catch {
			return defaultSkills;
		}

		let entries: string[];
		try {
			entries = await fs.promises.readdir(SKILLS_FS_ROOT);
		} catch {
			return defaultSkills;
		}

		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;

			try {
				const raw = await fs.promises.readFile(`${SKILLS_FS_ROOT}/${entry}`);
				const text = new TextDecoder().decode(raw);
				const { meta } = parseFrontmatter(text);
				const name = meta.name ?? filenameToName(entry);
				results.set(name, {
					name,
					description: meta.description ?? "",
					path: `${SKILLS_SANDBOX_ROOT}/${entry}`,
					origin: "custom",
					readOnly: false,
				});
			} catch (err) {
				logError(`Failed to read skill ${entry}:`, err);
			}
		}

		for (const skill of defaultSkills) {
			if (!results.has(skill.name)) {
				results.set(skill.name, skill);
			}
		}

		return [...results.values()];
	}

	/**
	 * Read a full skill by name (includes body content).
	 */
	async readSkill(name: string): Promise<Skill> {
		try {
			await this.initialize();
		} catch {
			const defaultSkill = await readDefaultSkill(name);
			if (defaultSkill) return defaultSkill;
			throw new Error(`Skill not found: ${name}`);
		}

		try {
			const raw = await documentFileSystemService.readFile(
				this.sandboxPath(name),
			);
			const text = new TextDecoder().decode(raw);
			const { meta, body } = parseFrontmatter(text);
			const resolvedName = meta.name ?? name;

			return {
				name: resolvedName,
				description: meta.description ?? "",
				body,
				path: this.sandboxPath(name),
				origin: "custom",
				readOnly: false,
			};
		} catch {
			const defaultSkill = await readDefaultSkill(name);
			if (defaultSkill) return defaultSkill;
			throw new Error(`Skill not found: ${name}`);
		}
	}

	/**
	 * Create or overwrite a skill. Caller provides name, description, and body separately;
	 * frontmatter is built internally.
	 */
	async writeSkill(
		name: string,
		description: string,
		body: string,
	): Promise<SkillSummary> {
		await this.initialize();

		const sanitized = nameToFilename(name);
		if (!sanitized) throw new Error("Invalid skill name");

		const content = buildContent(name, description, body);
		await documentFileSystemService.writeFile(
			this.sandboxPath(name),
			new TextEncoder().encode(content),
		);

		logInfo(`Skill written: ${this.fsPath(name)}`);

		return {
			name,
			description,
			path: this.sandboxPath(name),
			origin: "custom",
			readOnly: false,
		};
	}

	/**
	 * Delete a skill by name.
	 */
	async deleteSkill(name: string): Promise<void> {
		await this.initialize();

		const path = this.fsPath(name);
		try {
			await documentFileSystemService.deleteFile(this.sandboxPath(name));
			logInfo(`Skill deleted: ${path}`);
		} catch {
			throw new Error(`Skill not found: ${name}`);
		}
	}

	/**
	 * Fetch a skill file from a GitHub URL and save it.
	 * Accepts github.com blob URLs or raw.githubusercontent.com URLs.
	 */
	async importFromGithub(url: string): Promise<SkillSummary> {
		const rawUrl = toRawGithubUrl(url.trim());

		let text: string;
		try {
			const response = await fetch(rawUrl);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			text = await response.text();
		} catch (err) {
			throw new Error(
				`Failed to fetch from GitHub: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		const { meta, body } = parseFrontmatter(text);
		const name = meta.name ?? rawUrlToName(rawUrl);
		const description = meta.description ?? "";

		return this.writeSkill(name, description, body);
	}
}

export const skillFileSystemService = SkillFileSystem.getInstance();
