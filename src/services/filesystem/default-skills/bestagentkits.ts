import type { DefaultSkillManifestEntry } from "./types";

const REPO = "bestagentkits/agency-skills";
const SOURCE_ROOT = `https://github.com/${REPO}/blob/main`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/main`;

/**
 * Standalone specialties that fill gaps in the existing catalog. The agency
 * mirror's content-humanizer already comes from its original publisher in
 * alirezarezvani.ts, so retain that entry instead of adding a duplicate.
 */
const AGENCY_SKILL_SOURCES = [
	{
		name: "customer-journey-map",
		path: "skills/pm-skills/customer-journey-map/SKILL.md",
		collection: "product",
		description:
			"Map the customer journey through stages, touchpoints, emotions, pain points, and opportunities to improve the end-to-end experience.",
	},
	{
		name: "interview-script",
		path: "skills/pm-skills/interview-script/SKILL.md",
		collection: "product",
		description:
			"Prepare customer interview guides using jobs-to-be-done and The Mom Test, with unbiased questions grounded in past behavior.",
	},
	{
		name: "pre-mortem",
		path: "skills/pm-skills/pre-mortem/SKILL.md",
		collection: "product",
		description:
			"Analyze a product or launch plan for failure risks, separate real blockers from overblown concerns, and prioritize mitigations.",
	},
	{
		name: "prioritize-features",
		path: "skills/pm-skills/prioritize-features/SKILL.md",
		collection: "product",
		description:
			"Rank a feature backlog by impact, effort, risk, and strategic alignment, with clear recommendations and scope tradeoffs.",
	},
	{
		name: "release-notes",
		path: "skills/pm-skills/release-notes/SKILL.md",
		collection: "documentation",
		description:
			"Write user-facing release notes from tickets, product requirements, or changelogs, organized into features, improvements, and fixes.",
	},
	{
		name: "user-personas",
		path: "skills/pm-skills/user-personas/SKILL.md",
		collection: "product",
		description:
			"Build research-backed user personas with jobs-to-be-done, pains, gains, and insights for segmentation and product decisions.",
	},
	{
		name: "grant-writer",
		path: "skills/specialized/grant-writer/SKILL.md",
		collection: "documentation",
		description:
			"Develop grant proposals, letters of inquiry, budget narratives, and reporting plans for nonprofits, research institutions, and social enterprises.",
	},
	{
		name: "language-translator",
		path: "skills/specialized/language-translator/SKILL.md",
		collection: "documentation",
		description:
			"Translate Spanish and English with regional dialect awareness, cultural context, pronunciation guidance, and an appropriate tone.",
	},
	{
		name: "sales-discovery-coach",
		path: "skills/sales/sales-discovery-coach/SKILL.md",
		collection: "sales",
		description:
			"Improve sales discovery calls with SPIN, Gap Selling, and Sandler questions, current-state mapping, gap analysis, and call coaching.",
	},
	{
		name: "testing-accessibility-auditor",
		path: "skills/testing/testing-accessibility-auditor/SKILL.md",
		collection: "engineering",
		description:
			"Audit interfaces for WCAG accessibility barriers using automated checks, keyboard navigation, assistive technologies, and actionable remediation.",
	},
	{
		name: "support-support-responder",
		path: "skills/support/support-support-responder/SKILL.md",
		collection: "support",
		description:
			"Draft customer support responses, investigate and resolve issues, plan escalations, and improve support knowledge bases and service quality.",
	},
	{
		name: "design-inclusive-visuals-specialist",
		path: "skills/design/design-inclusive-visuals-specialist/SKILL.md",
		collection: "design-skills",
		description:
			"Create image and video prompts with culturally accurate representation, inclusive visual details, and constraints that reduce stereotypes.",
	},
];

export const BESTAGENTKITS_DEFAULT_SKILLS: DefaultSkillManifestEntry[] =
	AGENCY_SKILL_SOURCES.map(({ name, path, collection, description }) => ({
		name,
		description,
		publisher: "Best Agent Kits",
		collection,
		repo: REPO,
		sourceUrl: `${SOURCE_ROOT}/${path}`,
		rawUrl: `${RAW_ROOT}/${path}`,
	}));
