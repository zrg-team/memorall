import type { DefaultSkillManifestEntry } from "./types";

export const SECONDSKY_DEFAULT_SKILLS: DefaultSkillManifestEntry[] = [
	{
		name: "code-review",
		description:
			"Code review practices with technical rigor and verification gates. Use for receiving feedback, requesting code-reviewer subagent reviews, or preventing false completion claims in pull requests.",
		publisher: "Second Sky",
		collection: "tooling-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/code-review/skills/code-review/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/code-review/skills/code-review/SKILL.md",
	},
	{
		name: "systematic-debugging",
		description:
			"Four-phase debugging framework that ensures root cause investigation before attempting fixes. Never jump to solutions. Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.",
		publisher: "Second Sky",
		collection: "tooling-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/systematic-debugging/skills/systematic-debugging/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/systematic-debugging/skills/systematic-debugging/SKILL.md",
	},
	{
		name: "root-cause-tracing",
		description:
			"Systematically trace bugs backward through call stack to find original trigger. Use when errors occur deep in execution and you need to trace back to find the original trigger.",
		publisher: "Second Sky",
		collection: "tooling-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/root-cause-tracing/skills/root-cause-tracing/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/root-cause-tracing/skills/root-cause-tracing/SKILL.md",
	},
	{
		name: "verification-before-completion",
		description:
			"Run verification commands and confirm output before claiming success. Use when about to claim work is complete, fixed, or passing, before committing or creating PRs.",
		publisher: "Second Sky",
		collection: "tooling-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/code-review/skills/code-review/references/verification-before-completion.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/code-review/skills/code-review/references/verification-before-completion.md",
	},
	{
		name: "feature-dev",
		description:
			"Automate 7-phase feature development with specialized agents. Use for multi-file features, architectural decisions, or ambiguous requirements and integration patterns.",
		publisher: "Second Sky",
		collection: "tooling-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/feature-dev/skills/feature-dev/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/feature-dev/skills/feature-dev/SKILL.md",
	},
	{
		name: "technical-specification",
		description:
			"Creates detailed technical specifications for software projects covering requirements, architecture, APIs, and testing strategies. Use when planning features, documenting system design, or creating architecture decision records.",
		publisher: "Second Sky",
		collection: "documentation-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/technical-specification/skills/technical-specification/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/technical-specification/skills/technical-specification/SKILL.md",
	},
	{
		name: "api-design-principles",
		description:
			"Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers. Use when designing new APIs, reviewing API specifications, or establishing API design standards.",
		publisher: "Second Sky",
		collection: "api-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/api-design-principles/skills/api-design-principles/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/api-design-principles/skills/api-design-principles/SKILL.md",
	},
	{
		name: "api-testing",
		description:
			"HTTP API testing for TypeScript and Python stacks. Covers REST APIs, GraphQL, request and response validation, authentication, and error handling.",
		publisher: "Second Sky",
		collection: "api-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/api-testing/skills/api-testing/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/api-testing/skills/api-testing/SKILL.md",
	},
	{
		name: "responsive-web-design",
		description:
			"Builds adaptive web interfaces using Flexbox, CSS Grid, and media queries with a mobile-first approach. Use when creating multi-device layouts, implementing flexible UI systems, or ensuring cross-browser compatibility.",
		publisher: "Second Sky",
		collection: "web-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/responsive-web-design/skills/responsive-web-design/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/responsive-web-design/skills/responsive-web-design/SKILL.md",
	},
	{
		name: "web-performance-optimization",
		description:
			"Optimizes web application performance through code splitting, lazy loading, caching strategies, and Core Web Vitals monitoring. Use when improving load times, implementing service workers, or reducing bundle sizes.",
		publisher: "Second Sky",
		collection: "web-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/web-performance-optimization/skills/web-performance-optimization/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/web-performance-optimization/skills/web-performance-optimization/SKILL.md",
	},
	{
		name: "progressive-web-app",
		description:
			"Progressive Web Apps with service workers, web manifest, offline support, and installation prompts. Use for installable web apps, offline functionality, push notifications, or service worker and manifest setup.",
		publisher: "Second Sky",
		collection: "web-skills",
		repo: "secondsky/claude-skills",
		sourceUrl:
			"https://github.com/secondsky/claude-skills/blob/main/plugins/progressive-web-app/skills/progressive-web-app/SKILL.md",
		rawUrl:
			"https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/progressive-web-app/skills/progressive-web-app/SKILL.md",
	},
];
