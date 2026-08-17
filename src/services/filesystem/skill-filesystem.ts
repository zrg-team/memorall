import fs, { initializeFs } from "@/services/filesystem/fs";
import {
	listDefaultSkills,
	readDefaultSkill,
} from "@/services/filesystem/default-skills";
import { SANDBOX_FS_PREFIX } from "@/services/filesystem/sandbox-paths";
import { platform } from "@/platform/current";
import { logError, logInfo } from "@/utils/logger";

/**
 * Skills live on their own root, deliberately outside `/home/files`.
 *
 * `/home/files` is what the Files tab mounts as "/", so while skills lived at
 * `/home/files/skills` they showed up as a top-level `/skills` folder that
 * could be renamed, moved or deleted from Files — silently breaking every
 * skill, bundled ones included. `/home` is the IndexedDB mount, so a sibling
 * root is durable without being browsable as a document.
 */
const SKILLS_FS_ROOT = "/home/skills";
const LEGACY_SKILLS_FS_ROOT = `${SANDBOX_FS_PREFIX}/skills` as const;
const SKILLS_MIGRATION_STORAGE_KEY = "memorall.filesystem.skillsRoot.v1";

/** The one file that makes a directory a skill, per the SKILL.md standard. */
const SKILL_ENTRY_FILENAME = "SKILL.md";

/**
 * Standard name rule: lowercase letters, digits and hyphens, max 64 chars.
 * @see https://agentskills.io
 */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Directories a folder skill may carry alongside its SKILL.md. */
const RESOURCE_DIRECTORIES = ["references", "scripts", "assets"] as const;

export type SkillFormat = "file" | "folder";

export interface SkillResource {
	/** Path relative to the skill directory, e.g. "references/api.md". */
	path: string;
	name: string;
	kind: "markdown" | "image" | "other";
}

export interface SkillSummary {
	name: string;
	description: string;
	path: string;
	/** Whether this skill is a single .md file or a directory with a SKILL.md. */
	format?: SkillFormat;
	version?: string;
	author?: string;
	tags?: string[];
	license?: string;
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

/** A scalar or a list — enough of YAML for what SKILL.md frontmatter uses. */
type FrontmatterValue = string | string[];

interface FrontmatterResult {
	meta: Record<string, FrontmatterValue>;
	body: string;
}

const stripQuotes = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
};

/** Splits `a, "b, c", d` without breaking on commas inside quotes. */
const splitInlineList = (inner: string): string[] => {
	const items: string[] = [];
	let current = "";
	let quote: string | null = null;

	for (const char of inner) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ",") {
			items.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	items.push(current.trim());

	return items.filter(Boolean);
};

/**
 * Reads SKILL.md frontmatter: scalars, quoted scalars, inline lists
 * (`tags: [a, b]`) and block lists (`tags:` followed by `- a`). Deliberately
 * dependency-free — a full YAML parser is far more than this format needs.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: raw.trim() };

	const meta: Record<string, FrontmatterValue> = {};
	const lines = match[1].split(/\r?\n/);
	let blockListKey: string | null = null;

	for (const line of lines) {
		const blockItem = line.match(/^\s*-\s+(.*)$/);
		if (blockListKey && blockItem) {
			const value = stripQuotes(blockItem[1]);
			if (value) (meta[blockListKey] as string[]).push(value);
			continue;
		}
		blockListKey = null;

		const colonIdx = line.indexOf(":");
		if (colonIdx <= 0) continue;

		const key = line.slice(0, colonIdx).trim();
		if (!key) continue;
		const rawValue = line.slice(colonIdx + 1).trim();

		if (!rawValue) {
			// `tags:` on its own opens a block list; an empty scalar is also valid,
			// so start a list and drop it later if no items follow.
			blockListKey = key;
			meta[key] = [];
			continue;
		}

		if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			meta[key] = splitInlineList(rawValue.slice(1, -1));
			continue;
		}

		meta[key] = stripQuotes(rawValue);
	}

	// An empty block list never received items — treat it as an empty scalar so
	// `description:` with no value does not become `[]`.
	for (const [key, value] of Object.entries(meta)) {
		if (Array.isArray(value) && value.length === 0) meta[key] = "";
	}

	return { meta, body: match[2].trim() };
}

const asScalar = (value: FrontmatterValue | undefined): string | undefined =>
	typeof value === "string" ? value : undefined;

const asList = (value: FrontmatterValue | undefined): string[] | undefined => {
	if (Array.isArray(value)) return value.length ? value : undefined;
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return undefined;
};

const needsQuoting = (value: string): boolean =>
	/^[\s>|@`&*!%#{}[\],]/.test(value) ||
	/:\s/.test(value) ||
	value !== value.trim();

const serializeValue = (value: FrontmatterValue): string => {
	if (Array.isArray(value)) {
		return `[${value.map((item) => (needsQuoting(item) ? JSON.stringify(item) : item)).join(", ")}]`;
	}
	return needsQuoting(value) ? JSON.stringify(value) : value;
};

/**
 * Rebuilds the file. `extra` carries every frontmatter key we parsed but do not
 * model, so editing a skill never silently drops its `version` or `license`.
 */
function buildContent(
	name: string,
	description: string,
	body: string,
	extra: Record<string, FrontmatterValue> = {},
): string {
	const lines = [
		`name: ${serializeValue(name)}`,
		`description: ${serializeValue(description)}`,
	];
	for (const [key, value] of Object.entries(extra)) {
		if (key === "name" || key === "description") continue;
		if (Array.isArray(value) ? value.length === 0 : !value) continue;
		lines.push(`${key}: ${serializeValue(value)}`);
	}
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
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

/** Standard-conformant name check, used before writing anything to disk. */
export function validateSkillName(name: string): {
	valid: boolean;
	reason?: string;
} {
	const trimmed = name.trim();
	if (!trimmed) return { valid: false, reason: "Name is required." };
	if (trimmed.length > 64)
		return { valid: false, reason: "Name must be 64 characters or fewer." };
	if (!SKILL_NAME_PATTERN.test(trimmed)) {
		return {
			valid: false,
			reason:
				"Name must use lowercase letters, digits and hyphens, and start with a letter or digit.",
		};
	}
	return { valid: true };
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
		"Unsupported URL format. Use a GitHub file URL (github.com/.../blob/...), a folder URL (github.com/.../tree/...), or a raw URL (raw.githubusercontent.com).",
	);
}

interface GithubTreeTarget {
	owner: string;
	repo: string;
	ref: string;
	path: string;
}

/** Recognises `github.com/{owner}/{repo}/tree/{ref}/{path}` folder URLs. */
export function parseGithubTreeUrl(url: string): GithubTreeTarget | null {
	const match = url
		.trim()
		.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/);
	if (!match) return null;
	return {
		owner: match[1],
		repo: match[2],
		ref: match[3],
		path: match[4]?.replace(/\/$/, "") ?? "",
	};
}

function rawUrlToName(rawUrl: string): string {
	const parts = rawUrl.split("/");
	const filename = parts[parts.length - 1] ?? "skill";
	return filenameToName(filename);
}

const resourceKind = (filename: string): SkillResource["kind"] => {
	if (/\.md$/i.test(filename)) return "markdown";
	if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filename)) return "image";
	return "other";
};

const hasErrorCode = (error: unknown, code: string): boolean =>
	!!(
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code?: string }).code === code
	);

const isNotFoundError = (error: unknown): boolean =>
	hasErrorCode(error, "ENOENT");

const isExistsError = (error: unknown): boolean =>
	hasErrorCode(error, "EEXIST");

interface GithubContentEntry {
	name: string;
	path: string;
	type: string;
	download_url: string | null;
}

// ---------------------------------------------------------------------------
// Import descriptors
// ---------------------------------------------------------------------------

export interface SkillImportCandidate {
	name: string;
	description: string;
	format: SkillFormat;
	/** SKILL.md (or the single .md file) contents, frontmatter included. */
	entryContent: string;
	resources: { path: string; data: Uint8Array }[];
	/** Blocking problems — the candidate cannot be imported as-is. */
	errors: string[];
	/** Non-blocking problems the user should see before importing. */
	warnings: string[];
}

// ---------------------------------------------------------------------------
// SkillFileSystem
// ---------------------------------------------------------------------------

export class SkillFileSystem {
	private static instance: SkillFileSystem;
	private initialized = false;
	private initializing: Promise<void> | null = null;

	private constructor() {}

	static getInstance(): SkillFileSystem {
		if (!SkillFileSystem.instance) {
			SkillFileSystem.instance = new SkillFileSystem();
		}
		return SkillFileSystem.instance;
	}

	private async initialize(): Promise<void> {
		if (this.initialized) return;
		if (!this.initializing) {
			this.initializing = (async () => {
				await initializeFs();
				await this.ensureDirectory(SKILLS_FS_ROOT);
				await this.migrateLegacyRoot();
				this.initialized = true;
			})().finally(() => {
				this.initializing = null;
			});
		}
		return this.initializing;
	}

	private async ensureDirectory(path: string): Promise<void> {
		const segments = path.split("/").filter(Boolean);
		let current = "";
		for (const segment of segments) {
			current += `/${segment}`;
			try {
				await fs.promises.mkdir(current);
			} catch (error) {
				// Already there is the common case; anything else is real.
				if (isExistsError(error)) continue;
				throw error;
			}
		}
	}

	// ── Legacy root migration ────────────────────────────────────────────────

	private async isMigrationComplete(): Promise<boolean> {
		try {
			return (
				(await platform.persistentStore.get<boolean>(
					SKILLS_MIGRATION_STORAGE_KEY,
				)) === true
			);
		} catch {
			return false;
		}
	}

	private async markMigrationComplete(): Promise<void> {
		try {
			await platform.persistentStore.set(SKILLS_MIGRATION_STORAGE_KEY, true);
		} catch {
			// Non-extension test/runtime contexts still get a migrated root; the
			// flag is a fast path, not the correctness guarantee.
		}
	}

	/**
	 * Moves everything from the old `/home/files/skills` into `/home/skills`.
	 * Idempotent: re-entering with an absent or empty legacy root is a no-op, and
	 * a name that already exists at the destination keeps the destination copy.
	 */
	private async migrateLegacyRoot(): Promise<void> {
		if (await this.isMigrationComplete()) return;

		try {
			const stat = await fs.promises.stat(LEGACY_SKILLS_FS_ROOT);
			if (!stat.isDirectory()) {
				await this.markMigrationComplete();
				return;
			}
		} catch (error) {
			if (isNotFoundError(error)) {
				await this.markMigrationComplete();
				return;
			}
			throw error;
		}

		let entries: string[];
		try {
			entries = await fs.promises.readdir(LEGACY_SKILLS_FS_ROOT);
		} catch (error) {
			logError("Failed to read legacy skills root during migration:", error);
			return;
		}

		let moved = 0;
		for (const entry of entries) {
			const from = `${LEGACY_SKILLS_FS_ROOT}/${entry}`;
			const to = `${SKILLS_FS_ROOT}/${entry}`;
			try {
				await fs.promises.stat(to);
				logInfo(
					`Skill "${entry}" already exists at the new root; keeping it and leaving the legacy copy in place.`,
				);
				continue;
			} catch (error) {
				if (!isNotFoundError(error)) throw error;
			}

			try {
				await fs.promises.rename(from, to);
				moved += 1;
			} catch (error) {
				logError(`Failed to migrate skill "${entry}":`, error);
			}
		}

		await fs.promises.rmdir(LEGACY_SKILLS_FS_ROOT).catch(() => undefined);
		if (moved > 0) {
			logInfo(`Migrated ${moved} skill entr(ies) to ${SKILLS_FS_ROOT}`);
		}
		await this.markMigrationComplete();
	}

	// ── Path helpers ─────────────────────────────────────────────────────────

	private fileSkillPath(name: string): string {
		return `${SKILLS_FS_ROOT}/${nameToFilename(name)}.md`;
	}

	private folderSkillDir(name: string): string {
		return `${SKILLS_FS_ROOT}/${nameToFilename(name)}`;
	}

	private folderSkillEntryPath(name: string): string {
		return `${this.folderSkillDir(name)}/${SKILL_ENTRY_FILENAME}`;
	}

	/** Resolves which on-disk shape a custom skill currently uses. */
	private async resolveFormat(name: string): Promise<SkillFormat | null> {
		try {
			const stat = await fs.promises.stat(this.folderSkillEntryPath(name));
			if (stat.isFile()) return "folder";
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
		try {
			const stat = await fs.promises.stat(this.fileSkillPath(name));
			if (stat.isFile()) return "file";
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
		return null;
	}

	private entryPathFor(name: string, format: SkillFormat): string {
		return format === "folder"
			? this.folderSkillEntryPath(name)
			: this.fileSkillPath(name);
	}

	private async readText(path: string): Promise<string> {
		const raw = await fs.promises.readFile(path);
		return new TextDecoder().decode(raw);
	}

	private summaryFromMeta(
		meta: Record<string, FrontmatterValue>,
		fallbackName: string,
		format: SkillFormat,
	): SkillSummary {
		const name = asScalar(meta.name) ?? fallbackName;
		return {
			name,
			description: asScalar(meta.description) ?? "",
			path: this.entryPathFor(name, format),
			format,
			version: asScalar(meta.version),
			author: asScalar(meta.author),
			tags: asList(meta.tags),
			license: asScalar(meta.license),
			sourceUrl: asScalar(meta.sourceUrl),
			origin: "custom",
			readOnly: false,
		};
	}

	// ── Read ─────────────────────────────────────────────────────────────────

	/**
	 * List all skills (reads only frontmatter — efficient for large skill sets).
	 * A `*.md` entry is a file skill; a directory holding SKILL.md is a folder
	 * skill; any other directory is skipped.
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
			try {
				if (entry.endsWith(".md")) {
					const text = await this.readText(`${SKILLS_FS_ROOT}/${entry}`);
					const { meta } = parseFrontmatter(text);
					const summary = this.summaryFromMeta(
						meta,
						filenameToName(entry),
						"file",
					);
					results.set(summary.name, summary);
					continue;
				}

				const entryPath = `${SKILLS_FS_ROOT}/${entry}/${SKILL_ENTRY_FILENAME}`;
				let text: string;
				try {
					text = await this.readText(entryPath);
				} catch (error) {
					if (isNotFoundError(error)) {
						logError(
							`Skipping "${entry}": a skill directory must contain ${SKILL_ENTRY_FILENAME}.`,
						);
						continue;
					}
					throw error;
				}
				const { meta } = parseFrontmatter(text);
				const summary = this.summaryFromMeta(meta, entry, "folder");
				results.set(summary.name, summary);
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

		const format = await this.resolveFormat(name);
		if (format) {
			try {
				const text = await this.readText(this.entryPathFor(name, format));
				const { meta, body } = parseFrontmatter(text);
				return { ...this.summaryFromMeta(meta, name, format), body };
			} catch (error) {
				logError(`Failed to read skill "${name}":`, error);
			}
		}

		const defaultSkill = await readDefaultSkill(name);
		if (defaultSkill) return defaultSkill;
		throw new Error(`Skill not found: ${name}`);
	}

	/** Resources bundled with a folder skill. Always empty for a file skill. */
	async listSkillResources(name: string): Promise<SkillResource[]> {
		await this.initialize();
		if ((await this.resolveFormat(name)) !== "folder") return [];

		const dir = this.folderSkillDir(name);
		const resources: SkillResource[] = [];

		for (const subdir of RESOURCE_DIRECTORIES) {
			let entries: string[];
			try {
				entries = await fs.promises.readdir(`${dir}/${subdir}`);
			} catch {
				continue;
			}
			for (const entry of entries) {
				resources.push({
					path: `${subdir}/${entry}`,
					name: entry,
					kind: resourceKind(entry),
				});
			}
		}

		return resources.sort((a, b) => a.path.localeCompare(b.path));
	}

	async readSkillResource(name: string, relPath: string): Promise<Uint8Array> {
		await this.initialize();
		this.assertSafeResourcePath(relPath);
		return fs.promises.readFile(`${this.folderSkillDir(name)}/${relPath}`);
	}

	// ── Write ────────────────────────────────────────────────────────────────

	/**
	 * Create or overwrite a skill. Caller provides name, description, and body separately;
	 * frontmatter is built internally. Writes back to whichever format the skill
	 * already uses; new skills start as a single file.
	 */
	async writeSkill(
		name: string,
		description: string,
		body: string,
	): Promise<SkillSummary> {
		await this.initialize();

		const sanitized = nameToFilename(name);
		if (!sanitized) throw new Error("Invalid skill name");
		const validation = validateSkillName(sanitized);
		if (!validation.valid) throw new Error(validation.reason);

		const format = (await this.resolveFormat(name)) ?? "file";
		const target = this.entryPathFor(name, format);

		// Preserve frontmatter keys we do not model (version, license, tags…).
		let extra: Record<string, FrontmatterValue> = {};
		try {
			const { meta } = parseFrontmatter(await this.readText(target));
			extra = meta;
		} catch {
			// New skill — nothing to preserve.
		}

		if (format === "folder")
			await this.ensureDirectory(this.folderSkillDir(name));
		const content = buildContent(name, description, body, extra);
		await fs.promises.writeFile(target, new TextEncoder().encode(content));

		logInfo(`Skill written: ${target}`);

		return {
			name,
			description,
			path: target,
			format,
			tags: asList(extra.tags),
			version: asScalar(extra.version),
			license: asScalar(extra.license),
			origin: "custom",
			readOnly: false,
		};
	}

	private assertSafeResourcePath(relPath: string): void {
		const normalized = relPath.replace(/\\/g, "/");
		if (
			!normalized ||
			normalized.startsWith("/") ||
			normalized.split("/").some((part) => part === ".." || part === ".")
		) {
			throw new Error(`Invalid resource path: ${relPath}`);
		}
	}

	/**
	 * Write a bundled resource. Writing the first resource onto a file skill
	 * promotes it to a folder skill, so the user never has to pick a format.
	 */
	async writeSkillResource(
		name: string,
		relPath: string,
		data: Uint8Array,
	): Promise<void> {
		await this.initialize();
		this.assertSafeResourcePath(relPath);
		await this.promoteToFolder(name);

		const dir = this.folderSkillDir(name);
		const segments = relPath.split("/");
		segments.pop();
		if (segments.length) {
			await this.ensureDirectory(`${dir}/${segments.join("/")}`);
		}
		await fs.promises.writeFile(`${dir}/${relPath}`, data);
	}

	async deleteSkillResource(name: string, relPath: string): Promise<void> {
		await this.initialize();
		this.assertSafeResourcePath(relPath);
		await fs.promises.unlink(`${this.folderSkillDir(name)}/${relPath}`);
	}

	/** Converts `<slug>.md` into `<slug>/SKILL.md`. No-op if already a folder. */
	async promoteToFolder(name: string): Promise<void> {
		await this.initialize();
		const format = await this.resolveFormat(name);
		if (format === "folder") return;

		const dir = this.folderSkillDir(name);
		await this.ensureDirectory(dir);

		if (format === "file") {
			const content = await fs.promises.readFile(this.fileSkillPath(name));
			await fs.promises.writeFile(this.folderSkillEntryPath(name), content);
			await fs.promises.unlink(this.fileSkillPath(name)).catch(() => undefined);
			logInfo(`Promoted skill "${name}" to a folder bundle`);
		}
	}

	/**
	 * Delete a skill by name, in whichever format it uses.
	 */
	async deleteSkill(name: string): Promise<void> {
		await this.initialize();

		const format = await this.resolveFormat(name);
		if (!format) throw new Error(`Skill not found: ${name}`);

		if (format === "file") {
			await fs.promises.unlink(this.fileSkillPath(name));
		} else {
			await this.removeDirectory(this.folderSkillDir(name));
		}
		logInfo(`Skill deleted: ${name}`);
	}

	private async removeDirectory(dir: string): Promise<void> {
		let entries: string[];
		try {
			entries = await fs.promises.readdir(dir);
		} catch (error) {
			if (isNotFoundError(error)) return;
			throw error;
		}

		for (const entry of entries) {
			const child = `${dir}/${entry}`;
			const stat = await fs.promises.stat(child);
			if (stat.isDirectory()) await this.removeDirectory(child);
			else await fs.promises.unlink(child);
		}
		await fs.promises.rmdir(dir).catch(() => undefined);
	}

	// ── Import ───────────────────────────────────────────────────────────────

	/** Validates a parsed candidate and records why it may not be importable. */
	private describeCandidate(
		name: string,
		entryContent: string,
		format: SkillFormat,
		resources: { path: string; data: Uint8Array }[],
	): SkillImportCandidate {
		const { meta } = parseFrontmatter(entryContent);
		const resolvedName = asScalar(meta.name) ?? name;
		const description = asScalar(meta.description) ?? "";
		const errors: string[] = [];
		const warnings: string[] = [];

		const validation = validateSkillName(nameToFilename(resolvedName));
		if (!validation.valid) errors.push(validation.reason!);
		if (!description.trim()) {
			warnings.push(
				"No `description` — the agent reads this to decide when the skill applies.",
			);
		}

		return {
			name: resolvedName,
			description,
			format,
			entryContent,
			resources,
			errors,
			warnings,
		};
	}

	/** Writes an already-reviewed candidate to disk. */
	async commitImport(candidate: SkillImportCandidate): Promise<SkillSummary> {
		await this.initialize();
		if (candidate.errors.length) {
			throw new Error(candidate.errors.join(" "));
		}

		const { meta } = parseFrontmatter(candidate.entryContent);
		const existing = await this.resolveFormat(candidate.name);

		// Replacing a folder skill with a file skill would strand the old
		// directory, so clear whatever is there first.
		if (existing) await this.deleteSkill(candidate.name);

		if (candidate.format === "folder" || candidate.resources.length) {
			await this.ensureDirectory(this.folderSkillDir(candidate.name));
			await fs.promises.writeFile(
				this.folderSkillEntryPath(candidate.name),
				new TextEncoder().encode(candidate.entryContent),
			);
			for (const resource of candidate.resources) {
				await this.writeSkillResource(
					candidate.name,
					resource.path,
					resource.data,
				);
			}
		} else {
			await fs.promises.writeFile(
				this.fileSkillPath(candidate.name),
				new TextEncoder().encode(candidate.entryContent),
			);
		}

		return {
			name: candidate.name,
			description: candidate.description,
			path: this.entryPathFor(candidate.name, candidate.format),
			format: candidate.format,
			tags: asList(meta.tags),
			version: asScalar(meta.version),
			license: asScalar(meta.license),
			origin: "custom",
			readOnly: false,
		};
	}

	/**
	 * Turn picked `.md` files into one candidate each. Used by the "Upload files"
	 * lane; the caller reviews the result before `commitImport`.
	 */
	async planFileImport(files: File[]): Promise<SkillImportCandidate[]> {
		const candidates: SkillImportCandidate[] = [];
		for (const file of files) {
			if (!/\.md$/i.test(file.name)) continue;
			const text = await file.text();
			candidates.push(
				this.describeCandidate(filenameToName(file.name), text, "file", []),
			);
		}
		return candidates;
	}

	/**
	 * Turn a picked directory into candidates. A subtree containing SKILL.md
	 * becomes one folder skill (with its resources); any remaining loose `.md`
	 * file becomes a file skill of its own.
	 */
	async planFolderImport(files: File[]): Promise<SkillImportCandidate[]> {
		type Entry = { file: File; parts: string[] };
		const entries: Entry[] = files.map((file) => ({
			file,
			parts: (file.webkitRelativePath || file.name).split("/").filter(Boolean),
		}));

		// Directory prefixes that own a SKILL.md, deepest first so a nested bundle
		// claims its files before an ancestor does.
		const bundleRoots = entries
			.filter(
				(entry) => entry.parts[entry.parts.length - 1] === SKILL_ENTRY_FILENAME,
			)
			.map((entry) => entry.parts.slice(0, -1))
			.sort((a, b) => b.length - a.length);

		const claimed = new Set<File>();
		const candidates: SkillImportCandidate[] = [];

		for (const root of bundleRoots) {
			const prefix = root.join("/");
			const name = root[root.length - 1] ?? "skill";
			const members = entries.filter(
				(entry) =>
					!claimed.has(entry.file) &&
					entry.parts.slice(0, root.length).join("/") === prefix,
			);
			if (!members.length) continue;

			const entryFile = members.find(
				(member) =>
					member.parts.length === root.length + 1 &&
					member.parts[member.parts.length - 1] === SKILL_ENTRY_FILENAME,
			);
			if (!entryFile) continue;

			const resources: { path: string; data: Uint8Array }[] = [];
			for (const member of members) {
				claimed.add(member.file);
				if (member.file === entryFile.file) continue;
				const relPath = member.parts.slice(root.length).join("/");
				resources.push({
					path: relPath,
					data: new Uint8Array(await member.file.arrayBuffer()),
				});
			}

			candidates.push(
				this.describeCandidate(
					name,
					await entryFile.file.text(),
					"folder",
					resources,
				),
			);
		}

		for (const entry of entries) {
			if (claimed.has(entry.file)) continue;
			if (!/\.md$/i.test(entry.file.name)) continue;
			candidates.push(
				this.describeCandidate(
					filenameToName(entry.file.name),
					await entry.file.text(),
					"file",
					[],
				),
			);
		}

		return candidates;
	}

	/**
	 * Plan an import from GitHub. Accepts a single file (blob/raw URL) or a
	 * folder (`/tree/`) URL, which may itself be a bundle or a directory of
	 * skills.
	 */
	async planGithubImport(url: string): Promise<SkillImportCandidate[]> {
		const trimmed = url.trim();
		const tree = parseGithubTreeUrl(trimmed);
		if (!tree) {
			const rawUrl = toRawGithubUrl(trimmed);
			const text = await this.fetchText(rawUrl);
			return [this.describeCandidate(rawUrlToName(rawUrl), text, "file", [])];
		}
		return this.planGithubTreeImport(tree);
	}

	private async fetchText(url: string): Promise<string> {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			return await response.text();
		} catch (err) {
			throw new Error(
				`Failed to fetch from GitHub: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async fetchContents(
		target: GithubTreeTarget,
		path: string,
	): Promise<GithubContentEntry[]> {
		const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${path}?ref=${encodeURIComponent(target.ref)}`;
		const response = await fetch(url, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!response.ok) {
			throw new Error(
				`Failed to list ${path || "/"} in ${target.owner}/${target.repo}: HTTP ${response.status}`,
			);
		}
		const payload = await response.json();
		return Array.isArray(payload) ? payload : [payload];
	}

	private async planGithubTreeImport(
		target: GithubTreeTarget,
	): Promise<SkillImportCandidate[]> {
		const entries = await this.fetchContents(target, target.path);
		const hasEntryFile = entries.some(
			(entry) => entry.type === "file" && entry.name === SKILL_ENTRY_FILENAME,
		);

		// The URL points at one bundle.
		if (hasEntryFile) {
			return [await this.planGithubBundle(target, target.path)];
		}

		// The URL points at a directory of skills.
		const candidates: SkillImportCandidate[] = [];
		for (const entry of entries) {
			if (entry.type === "dir") {
				try {
					const children = await this.fetchContents(target, entry.path);
					if (
						children.some(
							(child) =>
								child.type === "file" && child.name === SKILL_ENTRY_FILENAME,
						)
					) {
						candidates.push(await this.planGithubBundle(target, entry.path));
					}
				} catch (error) {
					logError(`Skipping ${entry.path}:`, error);
				}
				continue;
			}
			if (
				entry.type === "file" &&
				/\.md$/i.test(entry.name) &&
				entry.download_url
			) {
				const text = await this.fetchText(entry.download_url);
				candidates.push(
					this.describeCandidate(filenameToName(entry.name), text, "file", []),
				);
			}
		}
		return candidates;
	}

	private async planGithubBundle(
		target: GithubTreeTarget,
		dirPath: string,
	): Promise<SkillImportCandidate> {
		const name = dirPath.split("/").filter(Boolean).pop() ?? target.repo;
		const entries = await this.fetchContents(target, dirPath);
		const entryFile = entries.find(
			(entry) => entry.type === "file" && entry.name === SKILL_ENTRY_FILENAME,
		);
		if (!entryFile?.download_url) {
			throw new Error(`No ${SKILL_ENTRY_FILENAME} in ${dirPath}`);
		}

		const entryContent = await this.fetchText(entryFile.download_url);
		const resources: { path: string; data: Uint8Array }[] = [];

		for (const subdir of RESOURCE_DIRECTORIES) {
			const dir = entries.find(
				(entry) => entry.type === "dir" && entry.name === subdir,
			);
			if (!dir) continue;
			let children: GithubContentEntry[];
			try {
				children = await this.fetchContents(target, dir.path);
			} catch (error) {
				logError(`Skipping ${dir.path}:`, error);
				continue;
			}
			for (const child of children) {
				if (child.type !== "file" || !child.download_url) continue;
				const response = await fetch(child.download_url);
				if (!response.ok) continue;
				resources.push({
					path: `${subdir}/${child.name}`,
					data: new Uint8Array(await response.arrayBuffer()),
				});
			}
		}

		return this.describeCandidate(name, entryContent, "folder", resources);
	}

	/**
	 * Fetch a skill file from a GitHub URL and save it.
	 * Accepts github.com blob URLs, folder (tree) URLs, or raw.githubusercontent.com URLs.
	 */
	async importFromGithub(url: string): Promise<SkillSummary> {
		const candidates = await this.planGithubImport(url);
		if (!candidates.length) {
			throw new Error("No skills found at that URL.");
		}
		const [first, ...rest] = candidates;
		const saved = await this.commitImport(first);
		for (const candidate of rest) {
			if (candidate.errors.length) continue;
			await this.commitImport(candidate);
		}
		return saved;
	}
}

export const skillFileSystemService = SkillFileSystem.getInstance();
export { SKILLS_FS_ROOT, LEGACY_SKILLS_FS_ROOT, SKILL_ENTRY_FILENAME };
