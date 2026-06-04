import { serviceRegistry } from "flow-core/registries/service-registry";

serviceRegistry.registerSchema("skillService", {
	name: "Skill Service",
	config: { required: false, category: "core" },
	metadata: { description: "Skill discovery and loading service" },
});

/**
 * Skill interface aligned with the SKILL.md open standard
 * (agentskills.io spec, co-governed by Anthropic / OpenAI / Google).
 *
 * Two-phase model:
 *   1. Discovery — agent reads SkillSummary.description to decide relevance.
 *      Body is NOT loaded at this stage (efficiency).
 *   2. Loading   — agent explicitly requests the full Skill to get instructions.
 */

// ── Discovery metadata (no body) ────────────────────────────────────────────

export interface SkillSummary {
	/** Unique identifier: lowercase letters, numbers, hyphens. Max 64 chars. */
	name: string;
	/** When to activate this skill. Agent reads this to decide relevance.
	 *  Must carry all trigger information — body is not read at discovery time. */
	description: string;
	/** Semantic version e.g. "1.0.0" */
	version?: string;
	/** Skill author / publisher */
	author?: string;
	/** Categorisation tags */
	tags?: string[];
	/** Explicit list of compatible agent types */
	agents?: string[];
	/** Source URL (e.g. GitHub raw link) */
	sourceUrl?: string;
	/** Whether this skill came bundled with the app or was added by the user */
	origin?: "default" | "custom";
	/** True for read-only skills (cannot be edited or deleted) */
	readOnly?: boolean;
}

// ── Full skill (summary + instructions body) ────────────────────────────────

export interface Skill extends SkillSummary {
	/** Markdown body — the actual instructions. Frontmatter is stripped. */
	body: string;
}

// ── Service interface ────────────────────────────────────────────────────────

export interface ISkillService {
	/** Phase 1 — discover available skills. Returns metadata only. */
	list(): Promise<SkillSummary[]>;
	/** Phase 2 — load the full skill body by name.
	 *  Throws if the skill does not exist. */
	load(name: string): Promise<Skill>;
}

declare global {
	interface ServiceRegistry {
		skillService?: ISkillService;
	}
}
