import type { DefaultSkillManifestEntry } from "./types";

const REPO = "coreyhaines31/marketingskills";
const SOURCE_ROOT = `https://github.com/${REPO}/blob/main/skills`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/main/skills`;

/**
 * Add marketing specialties missing from the existing collections. Include
 * their reference guides because defaults load as a single merged document.
 * Existing copywriting, SEO, and conversion skills keep their original sources.
 */
const MARKETING_SKILL_SOURCES = [
	{
		name: "co-marketing",
		description:
			"Find complementary partners and plan joint campaigns, cross-promotions, shared content, and co-marketing agreements.",
		references: ["partnership-types.md"],
	},
	{
		name: "community-marketing",
		description:
			"Plan, launch, and grow online communities, ambassador programs, and community-led support with measurable member and business outcomes.",
		references: ["community-models.md"],
	},
	{
		name: "customer-research",
		description:
			"Analyze interviews, surveys, reviews, and support tickets; plan primary research and turn customer evidence into personas and actionable insights.",
		references: ["interviews-and-surveys.md", "source-guides.md"],
	},
	{
		name: "events",
		description:
			"Plan webinars, conferences, workshops, and meetups; evaluate sponsorships, prepare talks, and measure event pipeline and follow-up.",
		references: [
			"event-portfolio-strategy.md",
			"speaking.md",
			"sponsorship-roi.md",
			"webinar-funnel.md",
		],
	},
	{
		name: "influencer-marketing",
		description:
			"Find and vet creators, structure partnerships, write briefs, and measure influencer, newsletter, podcast, and UGC sponsorship results.",
		references: [
			"newsletter-sponsorships.md",
			"paid-ads-creator-program.md",
			"telegram-channels.md",
			"ugc-creator-program.md",
		],
	},
	{
		name: "lead-magnets",
		description:
			"Plan and improve lead magnets, gated content, templates, and downloadable resources for email capture, including format selection and distribution.",
		references: [
			"benchmarks.md",
			"content-to-skill-corpus-design.md",
			"content-to-skill-release.md",
			"content-to-skill.md",
			"format-guide.md",
		],
	},
	{
		name: "offers",
		description:
			"Design service, course, coaching, and agency offers with value framing, bonuses, guarantees, payment options, and credible urgency.",
		references: [
			"bonus-stacking.md",
			"examples.md",
			"guarantee-design.md",
			"offer-anatomy.md",
			"offer-formats.md",
			"saas-offers.md",
			"scarcity-urgency.md",
			"value-equation.md",
		],
	},
	{
		name: "public-relations",
		description:
			"Plan earned media, journalist pitches, press kits, podcast appearances, and crisis communications with practical templates.",
		references: [
			"crisis-communications.md",
			"journalist-pitching.md",
			"media-outlets.md",
			"newsjacking.md",
			"podcast-guest-prep.md",
			"press-platforms.md",
			"statement-templates.md",
			"story-angles.md",
		],
	},
	{
		name: "site-architecture",
		description:
			"Plan website page hierarchy, navigation, URLs, internal links, and visual sitemaps, including platform selection and migration.",
		references: [
			"mermaid-templates.md",
			"navigation-patterns.md",
			"platforms-and-migration.md",
			"site-type-templates.md",
		],
	},
];

export const COREYHAINES31_DEFAULT_SKILLS: DefaultSkillManifestEntry[] =
	MARKETING_SKILL_SOURCES.map(({ name, description, references }) => ({
		name,
		description,
		publisher: "Corey Haines",
		collection: "marketing",
		repo: REPO,
		sourceUrl: `${SOURCE_ROOT}/${name}/SKILL.md`,
		rawUrls: [
			`${RAW_ROOT}/${name}/SKILL.md`,
			...references.map(
				(reference) => `${RAW_ROOT}/${name}/references/${reference}`,
			),
		],
	}));
