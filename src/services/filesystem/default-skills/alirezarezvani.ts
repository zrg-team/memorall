import type { DefaultSkillManifestEntry } from "./types";

const REPO = "alirezarezvani/claude-skills";
const SOURCE_ROOT = `https://github.com/${REPO}/blob/main`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/main`;

interface AlirezarezvaniSkillSource {
	name: string;
	/** SKILL.md in the repo, which nests skills differently per category. */
	path: string;
	collection: string;
	description: string;
}

/**
 * Skills from alirezarezvani/claude-skills (MIT) that read as complete
 * guidance on their own. Memorall loads only SKILL.md, so skills that are
 * mostly instructions to run their bundled scripts, routers over other
 * skills, and tooling for Claude Code's own memory and worktrees are left
 * out. Names already taken by another publisher stay with that publisher.
 */
const ALIREZAREZVANI_SKILL_SOURCES: AlirezarezvaniSkillSource[] = [
	{
		name: "adversarial-reviewer",
		path: "engineering-team/skills/adversarial-reviewer/SKILL.md",
		collection: "engineering",
		description:
			"Adversarial code review that breaks the self-review monoculture. Use when you want a genuinely critical review of recent changes, before merging a PR, or when you suspect Claude is being too agreeable about code quality. Forces perspective shifts through hostile reviewer personas that catch blind spots the author's mental model shares with the reviewer.",
	},
	{
		name: "aws-solution-architect",
		path: "engineering-team/skills/aws-solution-architect/SKILL.md",
		collection: "engineering",
		description:
			"Design AWS architectures for startups using serverless patterns and IaC templates. Use when asked to design serverless architecture, create CloudFormation templates, optimize AWS costs, set up CI/CD pipelines, or migrate to AWS. Covers Lambda, API Gateway, DynamoDB, ECS, Aurora, and cost optimization.",
	},
	{
		name: "behuman",
		path: "engineering/behuman/skills/behuman/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user wants more human-like AI responses: less robotic, less list-heavy, and more authentic. This is for conversational or emotionally charged exchanges, not technical questions, code generation, or factual lookups.",
	},
	{
		name: "code-tour",
		path: "engineering/code-tour/skills/code-tour/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user asks to create a CodeTour .tour file: onboarding tours, architecture tours, PR review tours, RCA tours, contributor guides, or any structured code walkthrough that links to real files and line numbers.",
	},
	{
		name: "codebase-onboarding",
		path: "engineering/skills/codebase-onboarding/SKILL.md",
		collection: "engineering",
		description:
			"Analyze a codebase and generate onboarding documentation for engineers, tech leads, and contractors. Fast fact-gathering and repeatable onboarding outputs. Use when onboarding a new engineer, writing architecture-overview docs for a new project, or producing tech-lead briefings for unfamiliar repos.",
	},
	{
		name: "database-schema-designer",
		path: "engineering/skills/database-schema-designer/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user asks to create ERD diagrams, normalize database schemas, design table relationships, or plan schema migrations.",
	},
	{
		name: "focused-fix",
		path: "engineering/skills/focused-fix/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user asks to fix, debug, or make a specific feature, module, or area work end-to-end. This skill is for systematic deep-dive repair across all files and dependencies, not quick single-bug fixes.",
	},
	{
		name: "incident-commander",
		path: "engineering-team/skills/incident-commander/SKILL.md",
		collection: "engineering",
		description:
			"Comprehensive incident response framework from detection through resolution and post-incident review. Battle-tested SRE/DevOps practices: severity classification, timeline reconstruction, structured post-incident analysis. Use when declaring an incident, coordinating multi-team response during an outage, leading a post-mortem, or setting up on-call practices for a new service.",
	},
	{
		name: "llm-cost-optimizer",
		path: "engineering/llm-cost-optimizer/skills/llm-cost-optimizer/SKILL.md",
		collection: "engineering",
		description:
			"Use proactively whenever LLM API costs come up -- or should. Triggers include: 'my AI costs are too high', 'optimize token usage', 'which model should I use', 'LLM spend is out of control', 'implement prompt caching', 'we're about to launch an AI feature', 'build me an AI endpoint'. Don't wait for an explicit cost complaint -- if someone is building an AI feature, designing an LLM endpoint, or choosing between models, cost architecture belongs in the conversation. Apply immediately when any of these are true: a system prompt appears that exceeds a few hundred tokens, all requests are hitting the same model, max_tokens is not set, or no per-feature cost logging exists. NOT for RAG pipeline design (use rag-architect). NOT for improving prompt quality or effectiveness (use senior-prompt-engineer).",
	},
	{
		name: "observability-designer",
		path: "engineering/skills/observability-designer/SKILL.md",
		collection: "engineering",
		description:
			"Design production-ready observability strategies combining metrics, logs, and traces. Includes SLI/SLO design, golden-signals monitoring, alert optimization. Use when adding observability to a new service, refactoring alerting that is too noisy, or designing an SLO program before scaling production load.",
	},
	{
		name: "playwright-pro",
		path: "engineering-team/playwright-pro/skills/pw/SKILL.md",
		collection: "engineering",
		description:
			"Production-grade Playwright testing toolkit. Use when the user mentions Playwright tests, end-to-end testing, browser automation, fixing flaky tests, test migration, CI/CD testing, or test suites. Generate tests, fix flaky failures, migrate from Cypress/Selenium, sync with TestRail, run on BrowserStack. 55 templates, 3 agents, smart reporting.",
	},
	{
		name: "pr-review-expert",
		path: "engineering/skills/pr-review-expert/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user asks to review pull requests, analyze code changes, check for security issues in PRs, or assess code quality of diffs.",
	},
	{
		name: "prompt-governance",
		path: "engineering/prompt-governance/skills/prompt-governance/SKILL.md",
		collection: "engineering",
		description:
			"Use when managing prompts in production at scale: versioning prompts, running A/B tests on prompts, building prompt registries, preventing prompt regressions, or creating eval pipelines for production AI features. Triggers: 'manage prompts in production', 'prompt versioning', 'prompt regression', 'prompt A/B test', 'prompt registry', 'eval pipeline'. NOT for writing or improving individual prompts (use senior-prompt-engineer). NOT for RAG pipeline design (use rag-architect). NOT for LLM cost reduction (use llm-cost-optimizer).",
	},
	{
		name: "rag-architect",
		path: "engineering/skills/rag-architect/SKILL.md",
		collection: "engineering",
		description:
			"Use when the user asks to design a RAG pipeline, choose a chunking strategy or embedding model, pick a vector database, or evaluate retrieval quality (precision@k, recall@k, NDCG). Examples: 'design a RAG system for our docs', 'what chunk size should I use for this corpus', 'evaluate my retriever against ground truth'. NOT for general LLM cost tuning (use llm-cost-optimizer) or agent loops over retrieval (use agenthub).",
	},
	{
		name: "ship-gate",
		path: "engineering/skills/ship-gate/SKILL.md",
		collection: "engineering",
		description:
			'Pre-production audit that scans a codebase for security, database, deployment, code quality, AI/LLM, dependency, frontend, and observability issues. Intercepts deploy commands and blocks until critical items pass. Stack-agnostic. Use for "run ship gate", "am I ready to ship", "pre-launch audit", "can I deploy", "push to production", "go live checklist", "preflight check". Not for CI/CD setup or infra provisioning.',
	},
	{
		name: "ab-test-setup",
		path: "marketing-skill/skills/ab-test-setup/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to plan, design, or implement an A/B test or experiment. Also use when the user mentions "A/B test," "split test," "experiment," "test this change," "variant copy," "multivariate test," "hypothesis," "conversion experiment," "statistical significance," or "test this." For tracking implementation, see analytics-tracking.',
	},
	{
		name: "ad-creative",
		path: "marketing-skill/skills/ad-creative/SKILL.md",
		collection: "marketing",
		description:
			"When the user needs to generate, iterate, or scale ad creative for paid advertising. Use when they say 'write ad copy,' 'generate headlines,' 'create ad variations,' 'bulk creative,' 'iterate on ads,' 'ad copy validation,' 'RSA headlines,' 'Meta ad copy,' 'LinkedIn ad,' or 'creative testing.' This is pure creative production — distinct from paid-ads (campaign strategy). Use ad-creative when you need the copy, not the campaign plan.",
	},
	{
		name: "aeo",
		path: "marketing-skill/skills/aeo/SKILL.md",
		collection: "marketing",
		description:
			"Answer Engine Optimization (AEO) skill — optimize content to be cited by AI language models (ChatGPT, Perplexity, Claude, Gemini, Mistral) as authoritative sources. Distinct from SEO — AEO optimizes for citation in LLM-generated responses, not search rankings. Use when planning content for AI-first search audiences, auditing existing content for E-E-A-T signals, tracking which pages get cited by which LLMs, or building a citation-friendly content strategy. Triggers — 'AEO audit', 'optimize for ChatGPT', 'get cited by Perplexity', 'LLM citation strategy', 'answer engine optimization', 'content for AI search', 'E-E-A-T audit'. Output is a markdown audit report (default) or JSON for pipeline integration. Stdlib-only Python tools.",
	},
	{
		name: "analytics-tracking",
		path: "marketing-skill/skills/analytics-tracking/SKILL.md",
		collection: "marketing",
		description:
			"Set up, audit, and debug analytics tracking implementation — GA4, Google Tag Manager, event taxonomy, conversion tracking, and data quality. Use when building a tracking plan from scratch, auditing existing analytics for gaps or errors, debugging missing events, or setting up GTM. Trigger keywords: GA4 setup, Google Tag Manager, GTM, event tracking, analytics implementation, conversion tracking, tracking plan, event taxonomy, custom dimensions, UTM tracking, analytics audit, missing events, tracking broken. NOT for analyzing marketing campaign data — use campaign-analytics for that. NOT for BI dashboards — use product-analytics for in-product event analysis.",
	},
	{
		name: "app-store-optimization",
		path: "marketing-skill/skills/app-store-optimization/SKILL.md",
		collection: "marketing",
		description:
			"App Store Optimization (ASO) toolkit for researching keywords, analyzing competitor rankings, generating metadata suggestions, and improving app visibility on Apple App Store and Google Play Store. Use when the user asks about ASO, app store rankings, app metadata, app titles and descriptions, app store listings, app visibility, or mobile app marketing on iOS or Android. Supports keyword research and scoring, competitor keyword analysis, metadata optimization, A/B test planning, launch checklists, and tracking ranking changes.",
	},
	{
		name: "campaign-analytics",
		path: "marketing-skill/skills/campaign-analytics/SKILL.md",
		collection: "marketing",
		description:
			"Analyzes campaign performance with multi-touch attribution, funnel conversion analysis, and ROI calculation for marketing optimization. Use when analyzing marketing campaigns, ad performance, attribution models, conversion rates, or calculating marketing ROI, ROAS, CPA, and campaign metrics across channels.",
	},
	{
		name: "churn-prevention",
		path: "marketing-skill/skills/churn-prevention/SKILL.md",
		collection: "marketing",
		description:
			"Reduce voluntary and involuntary churn through cancel flow design, save offers, exit surveys, and dunning sequences. Use when designing or optimizing a cancel flow, building save offers, setting up dunning emails, or reducing failed-payment churn. Trigger keywords: cancel flow, churn reduction, save offers, dunning, exit survey, payment recovery, win-back, involuntary churn, failed payments, cancel page. NOT for customer health scoring or expansion revenue — use customer-success-manager for that.",
	},
	{
		name: "cold-email",
		path: "marketing-skill/skills/cold-email/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to write, improve, or build a sequence of B2B cold outreach emails to prospects who haven't asked to hear from them. Use when the user mentions 'cold email,' 'cold outreach,' 'prospecting emails,' 'SDR emails,' 'sales emails,' 'first touch email,' 'follow-up sequence,' or 'email prospecting.' Also use when they share an email draft that sounds too sales-y and needs to be humanized. Distinct from email-sequence (lifecycle/nurture to opted-in subscribers) — this is unsolicited outreach to new prospects. NOT for lifecycle emails, newsletters, or drip campaigns (use email-sequence).",
	},
	{
		name: "competitor-alternatives",
		path: "marketing-skill/skills/competitor-alternatives/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the user mentions 'alternative page,' 'vs page,' 'competitor comparison,' 'comparison page,' '[Product] vs [Product],' '[Product] alternative,' 'competitive landing pages,' 'switch from competitor,' or 'comparison content.' Covers four formats: singular alternative, plural alternatives, you vs competitor, and competitor vs competitor. Emphasizes deep research, modular content architecture, and varied section types beyond feature tables.",
	},
	{
		name: "content-humanizer",
		path: "marketing-skill/skills/content-humanizer/SKILL.md",
		collection: "marketing",
		description:
			"Makes AI-generated content sound genuinely human — not just cleaned up, but alive. Use when content feels robotic, uses too many AI clichés, lacks personality, or reads like it was written by committee. Triggers: 'this sounds like AI', 'make it more human', 'add personality', 'it feels generic', 'sounds robotic', 'fix AI writing', 'inject our voice'. NOT for initial content creation (use content-production). NOT for SEO optimization (use content-production Mode 3).",
	},
	{
		name: "content-strategy",
		path: "marketing-skill/skills/content-strategy/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to plan a content strategy, decide what content to create, or figure out what topics to cover. Also use when the user mentions "content strategy," "what should I write about," "content ideas," "blog strategy," "topic clusters," or "content planning." For writing individual pieces, see copywriting. For SEO-specific audits, see seo-audit.',
	},
	{
		name: "copy-editing",
		path: "marketing-skill/skills/copy-editing/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to edit, review, or improve existing marketing copy. Also use when the user mentions 'edit this copy,' 'review my copy,' 'copy feedback,' 'proofread,' 'polish this,' 'make this better,' or 'copy sweep.' This skill provides a systematic approach to editing marketing copy through multiple focused passes.",
	},
	{
		name: "copywriting",
		path: "marketing-skill/skills/copywriting/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to write, rewrite, or improve marketing copy for any page — including homepage, landing pages, pricing pages, feature pages, about pages, or product pages. Also use when the user says "write copy for," "improve this copy," "rewrite this page," "marketing copy," "headline help," or "CTA copy." For email copy, see email-sequence. For popup copy, see popup-cro.',
	},
	{
		name: "email-sequence",
		path: "marketing-skill/skills/email-sequence/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to create or optimize an email sequence, drip campaign, automated email flow, or lifecycle email program. Also use when the user mentions "email sequence," "drip campaign," "nurture sequence," "onboarding emails," "welcome sequence," "re-engagement emails," "email automation," or "lifecycle emails." For in-app onboarding, see onboarding-cro.',
	},
	{
		name: "launch-strategy",
		path: "marketing-skill/skills/launch-strategy/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to plan a product launch, feature announcement, or release strategy. Also use when the user mentions 'launch,' 'Product Hunt,' 'feature release,' 'announcement,' 'go-to-market,' 'beta launch,' 'early access,' 'waitlist,' 'product update,' 'GTM plan,' 'launch checklist,' or 'launch momentum.' This skill covers phased launches, channel strategy, and ongoing launch momentum.",
	},
	{
		name: "linkedin-strategy",
		path: "marketing/linkedin/skills/linkedin-strategy/SKILL.md",
		collection: "marketing",
		description:
			'Use when someone needs a LinkedIn plan rather than a post — content pillars, positioning for a career change or consulting or thought leadership, a sustainable posting cadence, or a newsletter decision. Triggers on "what should I post about", "how often should I post", "LinkedIn content strategy", "should I start a LinkedIn newsletter", "grow my following", "90-day plan". Validates the positioning brief, sizes the week against real hours and refuses a plan that will not survive week five, and gates a newsletter against eligibility and a six-month cadence commitment.',
	},
	{
		name: "local-seo-manager",
		path: "marketing-skill/skills/local-seo-manager/SKILL.md",
		collection: "marketing",
		description:
			"Manage local SEO for service-area businesses — appliance repair, HVAC, plumbing, cleaning, and any business that serves customers at their location. Use when the user wants to: audit Google Business Profile, generate neighborhood service area pages, check NAP consistency across directories, create LocalBusiness schema, or write review responses. Triggers: 'local SEO', 'Google Business Profile', 'GBP', 'service area page', 'NAP consistency', 'local citations', 'LocalBusiness schema', 'review responses', 'Google Maps ranking'. NOT for national SEO (use seo-audit). NOT for general schema (use schema-markup). NOT for AI answer-engine visibility (use aeo).",
	},
	{
		name: "marketing-context",
		path: "marketing-skill/skills/marketing-context/SKILL.md",
		collection: "marketing",
		description:
			"Create and maintain the marketing context document that all marketing skills read before starting. Use when the user mentions 'marketing context,' 'brand voice,' 'set up context,' 'target audience,' 'ICP,' 'style guide,' 'who is my customer,' 'positioning,' or wants to avoid repeating foundational information across marketing tasks. Run this at the start of any new project before using other marketing skills.",
	},
	{
		name: "marketing-ideas",
		path: "marketing-skill/skills/marketing-ideas/SKILL.md",
		collection: "marketing",
		description:
			"When the user needs marketing ideas, inspiration, or strategies for their SaaS or software product. Also use when the user asks for 'marketing ideas,' 'growth ideas,' 'how to market,' 'marketing strategies,' 'marketing tactics,' 'ways to promote,' or 'ideas to grow.' This skill provides 139 proven marketing approaches organized by category.",
	},
	{
		name: "marketing-psychology",
		path: "marketing-skill/skills/marketing-psychology/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to apply psychological principles, mental models, or behavioral science to marketing. Also use when the user mentions 'psychology,' 'mental models,' 'cognitive bias,' 'persuasion,' 'behavioral science,' 'why people buy,' 'decision-making,' or 'consumer behavior.' This skill provides 70+ mental models organized for marketing application.",
	},
	{
		name: "marketing-strategy-pmm",
		path: "marketing-skill/skills/marketing-strategy-pmm/SKILL.md",
		collection: "marketing",
		description:
			"Product marketing skill for positioning, GTM strategy, competitive intelligence, and product launches. Use when the user asks about product positioning, go-to-market planning, competitive analysis, target audience definition, ICP definition, market research, launch plans, or sales enablement. Covers April Dunford positioning, ICP definition, competitive battlecards, launch playbooks, and international market entry. Produces deliverables including positioning statements, battlecard documents, launch plans, and go-to-market strategies.",
	},
	{
		name: "onboarding-cro",
		path: "marketing-skill/skills/onboarding-cro/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to optimize post-signup onboarding, user activation, first-run experience, or time-to-value. Also use when the user mentions "onboarding flow," "activation rate," "user activation," "first-run experience," "empty states," "onboarding checklist," "aha moment," or "new user experience." For signup/registration optimization, see signup-flow-cro. For ongoing email sequences, see email-sequence.',
	},
	{
		name: "page-cro",
		path: "marketing-skill/skills/page-cro/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to optimize, improve, or increase conversions on any marketing page — including homepage, landing pages, pricing pages, feature pages, or blog posts. Also use when the user says "CRO," "conversion rate optimization," "this page isn\'t converting," "improve conversions," or "why isn\'t this page working." For signup/registration flows, see signup-flow-cro. For post-signup activation, see onboarding-cro. For forms outside of signup, see form-cro. For popups/modals, see popup-cro.',
	},
	{
		name: "paid-ads",
		path: "marketing-skill/skills/paid-ads/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants help with paid advertising campaigns on Google Ads, Meta (Facebook/Instagram), LinkedIn, Twitter/X, or other ad platforms. Also use when the user mentions 'PPC,' 'paid media,' 'ad copy,' 'ad creative,' 'ROAS,' 'CPA,' 'ad campaign,' 'retargeting,' or 'audience targeting.' This skill covers campaign strategy, ad creation, audience targeting, and optimization.",
	},
	{
		name: "pricing-strategy",
		path: "marketing-skill/skills/pricing-strategy/SKILL.md",
		collection: "marketing",
		description:
			"Design, optimize, and communicate SaaS pricing — tier structure, value metrics, pricing pages, and price increase strategy. Use when building a pricing model from scratch, redesigning existing pricing, planning a price increase, or improving a pricing page. Trigger keywords: pricing tiers, pricing page, price increase, packaging, value metric, per seat pricing, usage-based pricing, freemium, good-better-best, pricing strategy, monetization, pricing page conversion, Van Westendorp. NOT for broader product strategy — use product-strategist for that. NOT for customer success or renewals — use customer-success-manager for expansion revenue.",
	},
	{
		name: "programmatic-seo",
		path: "marketing-skill/skills/programmatic-seo/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to create SEO-driven pages at scale using templates and data. Also use when the user mentions "programmatic SEO," "template pages," "pages at scale," "directory pages," "location pages," "[keyword] + [city] pages," "comparison pages," "integration pages," or "building many pages for SEO." For auditing existing SEO issues, see seo-audit.',
	},
	{
		name: "referral-program",
		path: "marketing-skill/skills/referral-program/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to design, launch, or optimize a referral or affiliate program. Use when they mention 'referral program,' 'affiliate program,' 'word of mouth,' 'refer a friend,' 'incentive program,' 'customer referrals,' 'brand ambassador,' 'partner program,' 'referral link,' or 'growth through referrals.' Covers program mechanics, incentive design, and optimization — not just the idea of referrals but the actual system.",
	},
	{
		name: "seo-audit",
		path: "marketing-skill/skills/seo-audit/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to audit, review, or diagnose SEO issues on their site. Also use when the user mentions "SEO audit," "technical SEO," "why am I not ranking," "SEO issues," "on-page SEO," "meta tags review," or "SEO health check." For building pages at scale to target keywords, see programmatic-seo. For adding structured data, see schema-markup.',
	},
	{
		name: "signup-flow-cro",
		path: "marketing-skill/skills/signup-flow-cro/SKILL.md",
		collection: "marketing",
		description:
			'When the user wants to optimize signup, registration, account creation, or trial activation flows. Also use when the user mentions "signup conversions," "registration friction," "signup form optimization," "free trial signup," "reduce signup dropoff," or "account creation flow." For post-signup onboarding, see onboarding-cro. For lead capture forms (not account creation), see form-cro.',
	},
	{
		name: "social-content",
		path: "marketing-skill/skills/social-content/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants help creating, scheduling, or optimizing social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook, or other platforms. Also use when the user mentions 'LinkedIn post,' 'Twitter thread,' 'social media,' 'content calendar,' 'social scheduling,' 'engagement,' or 'viral content.' This skill covers content creation, repurposing, and platform-specific strategies.",
	},
	{
		name: "social-media-manager",
		path: "marketing-skill/skills/social-media-manager/SKILL.md",
		collection: "marketing",
		description:
			"When the user wants to develop social media strategy, plan content calendars, manage community engagement, or grow their social presence across platforms. Also use when the user mentions 'social media strategy,' 'social calendar,' 'community management,' 'social media plan,' 'grow followers,' 'engagement rate,' 'social media audit,' or 'which platforms should I use.' For writing individual social posts, see social-content. For analyzing social performance data, see social-media-analyzer.",
	},
	{
		name: "video-content-strategist",
		path: "marketing-skill/video-content-strategist/skills/video-content-strategist/SKILL.md",
		collection: "marketing",
		description:
			"Use when planning video content strategy, writing video scripts, optimizing YouTube channels, building short-form video pipelines (Reels, TikTok, Shorts), or repurposing long-form content into video. Triggers: 'start a YouTube channel', 'video content strategy', 'write a video script', 'repurpose into video', 'YouTube SEO', 'short-form video'. NOT for written blog content (use content-production). NOT for social captions without video (use social-media-manager).",
	},
	{
		name: "commercial-forecaster",
		path: "commercial/skills/commercial-forecaster/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Use when building a quarterly bookings forecast, ARR projection, pipeline forecast, NRR projection, or commit/best-case/pipe-only board number — especially when the CRO needs to walk the board through funnel math + cohort ARR + per-stage conversion assumptions without the theatre of a single undefended number. Decomposes pipeline into commit, best-case, and pipe-only tiers; projects cohort-level NRR/GRR to surface leaky cohorts before they show up in the consolidated number; scores per-stage funnel confidence so soft-floor stages get treated differently from high-confidence ones. Every output explicitly names the conversion rate used, the data window, and the weighting choice. For Head of Commercial, RevOps, VP Sales, and CRO at quarterly forecast or board prep. NOT financial close (see finance/financial-analysis). NOT strategic CRO hiring/territory (see c-level-advisor/cro-advisor). NOT pricing (see sibling pricing-strategist).",
	},
	{
		name: "contract-and-proposal-writer",
		path: "business-growth/skills/contract-and-proposal-writer/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Generate professional, jurisdiction-aware business documents: freelance contracts, project proposals, SOWs, NDAs, and MSAs. Structured Markdown output with docx conversion instructions. Covers US (Delaware), EU (GDPR), UK, and DACH (German law) jurisdictions. Not a substitute for legal counsel — use as strong starting points. Use when drafting a freelance contract, preparing a client proposal, writing an SOW for a new engagement, or producing an NDA before sharing sensitive material.",
	},
	{
		name: "customer-success-manager",
		path: "business-growth/skills/customer-success-manager/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Monitors customer health, predicts churn risk, and identifies expansion opportunities using weighted scoring models for SaaS customer success. Use when analyzing customer accounts, reviewing retention metrics, scoring at-risk customers, or when the user mentions churn, customer health scores, upsell opportunities, expansion revenue, retention analysis, or customer analytics. Runs three Python CLI tools to produce deterministic health scores, churn risk tiers, and prioritized expansion recommendations across Enterprise, Mid-Market, and SMB segments.",
	},
	{
		name: "deal-desk",
		path: "commercial/skills/deal-desk/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Use when reviewing a specific inbound deal before close — when sales has asked for a discount that exceeds AE authority, when the customer has redlined the MSA, when per-deal economics (margin after discount, multi-year payment shape, indemnity exposure) need to be quantified, or when discount approval needs to be routed to a named human approver (Sales Director, VP Sales, CFO, CRO, General Counsel). Covers deal review, discount approval routing, per-deal margin scoring, deal exception handling, MSA redline triage, contract landmine detection (uncapped indemnity, MFN, perpetual license-back, missing DPA), and named-approver chain assembly. NEVER auto-approves — every output is a numeric scorecard plus a routing recommendation to a named human.",
	},
	{
		name: "partnerships-architect",
		path: "commercial/skills/partnerships-architect/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Use when a startup is approached by a prospective partner and someone has to decide should we sign this partner, at what partner tier (referral / reseller / OEM / SI-consulting / strategic alliance), with what joint GTM commitment, and at what revshare. Classifies partner tier from independent-demand evidence vs. preferential-terms hunting, designs a 90-day joint GTM plan, models revshare against direct-sale margin, and surfaces kill criteria for unwinding under-performing partnerships. For Head of Partnerships, Head of BD, and Founder-CEOs doing reseller agreement, OEM deal, or strategic alliance review — not technical sale enablement, not channel cost economics, not M&A.",
	},
	{
		name: "revenue-operations",
		path: "business-growth/skills/revenue-operations/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Analyzes sales pipeline health, revenue forecasting accuracy, and go-to-market efficiency metrics for SaaS revenue optimization. Use when analyzing sales pipeline coverage, forecasting revenue, evaluating go-to-market performance, reviewing sales metrics, assessing pipeline analysis, tracking forecast accuracy with MAPE, calculating GTM efficiency, or measuring sales efficiency and unit economics for SaaS teams.",
	},
	{
		name: "rfp-responder",
		path: "commercial/skills/rfp-responder/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Use when an RFP, RFI, RFQ, security questionnaire, vendor questionnaire, or proposal request arrives and the team needs a structured response — parsing multi-section buyer-dictated requirements (MANDATORY vs WEIGHTED vs NICE-TO-HAVE), building a Shipley-method proof-point matrix mapping each requirement to a verifiable proof point, articulating 3-5 win-themes that ladder up across requirements, and producing a Shipley-derived winrate estimate that informs a bid / no-bid / partner-bid recommendation. For Bid Managers, Proposal Leads, Directors of Sales, and Sales Engineers at the response-strategy moment. Surfaces GAP requirements explicitly — never invents claims. NOT free-form proposal narrative authoring, NOT contract redline, NOT marketing collateral.",
	},
	{
		name: "sales-engineer",
		path: "business-growth/skills/sales-engineer/SKILL.md",
		collection: "sales-and-growth",
		description:
			"Analyzes RFP/RFI responses for coverage gaps, builds competitive feature comparison matrices, and plans proof-of-concept (POC) engagements for pre-sales engineering. Use when responding to RFPs, bids, or proposal requests; comparing product features against competitors; planning or scoring a customer POC or sales demo; preparing a technical proposal; or performing win/loss competitor analysis. Handles tasks described as 'RFP response', 'bid response', 'proposal response', 'competitor comparison', 'feature matrix', 'POC planning', 'sales demo prep', or 'pre-sales engineering'.",
	},
	{
		name: "board-deck-builder",
		path: "c-level-advisor/skills/board-deck-builder/SKILL.md",
		collection: "leadership",
		description:
			"Assembles comprehensive board and investor update decks by pulling perspectives from all C-suite roles. Use when preparing board meetings, investor updates, quarterly business reviews, or fundraising narratives. Covers structure, narrative framework, bad news delivery, and common mistakes.",
	},
	{
		name: "board-prep",
		path: "c-level-advisor/executive-mentor/skills/board-prep/SKILL.md",
		collection: "leadership",
		description:
			"Board meeting preparation for the adversarial scenario, not the friendly one. Forces numbers-cold mastery, anticipates hard questions, builds a narrative that acknowledges weakness without losing the room. Use when preparing for a board meeting, an investor update, fundraising presentation, or any high-stakes adversarial review where every number must live in your head not just on a slide.",
	},
	{
		name: "ceo-advisor",
		path: "c-level-advisor/skills/ceo-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Executive leadership guidance for strategic decision-making, organizational development, and stakeholder management. Use when planning strategy, preparing board presentations, managing investors, developing organizational culture, making executive decisions, fundraising, or when user mentions CEO, strategic planning, board meetings, investor updates, organizational leadership, or executive strategy.",
	},
	{
		name: "cfo-advisor",
		path: "c-level-advisor/skills/cfo-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Financial leadership for startups and scaling companies. Financial modeling, unit economics, fundraising strategy, cash management, and board financial packages. Use when building financial models, analyzing unit economics, planning fundraising, managing cash runway, preparing board materials, or when user mentions CFO, burn rate, runway, fundraising, unit economics, LTV, CAC, term sheets, or financial strategy.",
	},
	{
		name: "change-management",
		path: "c-level-advisor/skills/change-management/SKILL.md",
		collection: "leadership",
		description:
			"Framework for rolling out organizational changes without chaos. Covers the ADKAR model adapted for startups, communication templates, resistance patterns, and change fatigue management. Handles process changes, org restructures, strategy pivots, and culture changes. Use when announcing a reorg, switching tools, pivoting strategy, killing a product, changing leadership, or when user mentions change management, change rollout, managing resistance, org change, reorg, or pivot communication.",
	},
	{
		name: "chro-advisor",
		path: "c-level-advisor/skills/chro-advisor/SKILL.md",
		collection: "leadership",
		description:
			"People leadership for scaling companies. Hiring strategy, compensation design, org structure, culture, and retention. Use when building hiring plans, designing comp frameworks, restructuring teams, managing performance, building culture, or when user mentions CHRO, HR, people strategy, talent, headcount, compensation, org design, retention, or performance management.",
	},
	{
		name: "ciso-advisor",
		path: "c-level-advisor/skills/ciso-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Security leadership for growth-stage companies. Risk quantification in dollars, compliance roadmap (SOC 2/ISO 27001/HIPAA/GDPR), security architecture strategy, incident response leadership, and board-level security reporting. Use when building security programs, justifying security budget, selecting compliance frameworks, managing incidents, assessing vendor risk, or when user mentions CISO, security strategy, compliance roadmap, zero trust, or board security reporting.",
	},
	{
		name: "cmo-advisor",
		path: "c-level-advisor/skills/cmo-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Marketing leadership for scaling companies. Brand positioning, growth model design, marketing budget allocation, and marketing org design. Use when designing brand strategy, selecting growth models (PLG vs sales-led vs community-led), allocating marketing budgets, building marketing teams, or when user mentions CMO, brand strategy, growth model, CAC, LTV, channel mix, or marketing ROI.",
	},
	{
		name: "competitive-intel",
		path: "c-level-advisor/skills/competitive-intel/SKILL.md",
		collection: "leadership",
		description:
			"Systematic competitor tracking that feeds CMO positioning, CRO battlecards, and CPO roadmap decisions. Use when analyzing competitors, building sales battlecards, tracking market moves, positioning against alternatives, or when user mentions competitive intelligence, competitive analysis, competitor research, battlecards, win/loss, or market positioning.",
	},
	{
		name: "coo-advisor",
		path: "c-level-advisor/skills/coo-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Operations leadership for scaling companies. Process design, OKR execution, operational cadence, and scaling playbooks. Use when designing operations, setting up OKRs, building processes, scaling teams, analyzing bottlenecks, planning operational cadence, or when user mentions COO, operations, process improvement, OKRs, scaling, operational efficiency, or execution.",
	},
	{
		name: "cpo-advisor",
		path: "c-level-advisor/skills/cpo-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Product leadership for scaling companies. Product vision, portfolio strategy, product-market fit, and product org design. Use when setting product vision, managing a product portfolio, measuring PMF, designing product teams, prioritizing at the portfolio level, reporting to the board on product, or when user mentions CPO, product strategy, product-market fit, product organization, portfolio prioritization, or roadmap strategy.",
	},
	{
		name: "cro-advisor",
		path: "c-level-advisor/skills/cro-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Revenue leadership for B2B SaaS companies. Revenue forecasting, sales model design, pricing strategy, net revenue retention, and sales team scaling. Use when designing the revenue engine, setting quotas, modeling NRR, evaluating pricing, building board forecasts, or when user mentions CRO, chief revenue officer, revenue strategy, sales model, ARR growth, NRR, expansion revenue, churn, pricing strategy, or sales capacity.",
	},
	{
		name: "cto-advisor",
		path: "c-level-advisor/skills/cto-advisor/SKILL.md",
		collection: "leadership",
		description:
			"Technical leadership guidance for engineering teams, architecture decisions, and technology strategy. Use when assessing technical debt, scaling engineering teams, evaluating technologies, making architecture decisions, establishing engineering metrics, or when user mentions CTO, tech debt, technical debt, team scaling, architecture decisions, technology evaluation, engineering metrics, DORA metrics, or technology strategy.",
	},
	{
		name: "culture-architect",
		path: "c-level-advisor/skills/culture-architect/SKILL.md",
		collection: "leadership",
		description:
			"Build, measure, and evolve company culture as operational behavior — not wall posters. Covers mission/vision/values workshops, values-to-behaviors translation, culture code creation, culture health assessment, and cultural rituals by stage. Use when building company values, assessing culture health, designing cultural rituals, creating culture codes, handling culture clashes, or when user mentions culture, values, culture debt, founder culture, or culture code.",
	},
	{
		name: "founder-coach",
		path: "c-level-advisor/skills/founder-coach/SKILL.md",
		collection: "leadership",
		description:
			"Personal leadership development for founders and first-time CEOs. Covers founder archetype identification, delegation frameworks, energy management, CEO calendar audits, leadership style evolution, blind spot identification, imposter syndrome, founder mental health, and succession planning. Use when a founder feels like the bottleneck, struggles to delegate, is burning out, transitioning from IC to executive, managing a board, or when user mentions founder mode, CEO growth, leadership development, delegation, burnout, or imposter syndrome.",
	},
	{
		name: "general-counsel-advisor",
		path: "c-level-advisor/skills/general-counsel-advisor/SKILL.md",
		collection: "leadership",
		description:
			"General Counsel advisory for startups: contract review (MSA, SaaS, NDA, DPA, employment), IP strategy, term sheet decoding, and regulatory landscape mapping. Use when reviewing any contract or term sheet, deciding when to engage outside counsel, defining IP strategy, evaluating regulatory exposure (HIPAA, GDPR, FDA, fintech), or when user mentions general counsel, GC, legal review, contract risk, term sheet, IP assignment, or regulatory exposure. NOT a substitute for licensed counsel — surfaces questions to bring to qualified attorneys.",
	},
	{
		name: "hard-call",
		path: "c-level-advisor/executive-mentor/skills/hard-call/SKILL.md",
		collection: "leadership",
		description:
			"Framework for decisions with no good options. Use when every option is painful and a structured 10/10/10 + regret-minimization pass is needed — e.g. choosing between a layoff and a down round, or killing a beloved product line.",
	},
	{
		name: "intl-expansion",
		path: "c-level-advisor/skills/intl-expansion/SKILL.md",
		collection: "leadership",
		description:
			"International market expansion strategy. Market selection, entry modes, localization, regulatory compliance, and go-to-market by region. Use when expanding to new countries, evaluating international markets, planning localization, or building regional teams.",
	},
	{
		name: "ma-playbook",
		path: "c-level-advisor/skills/ma-playbook/SKILL.md",
		collection: "leadership",
		description:
			"M&A strategy for acquiring companies or being acquired. Due diligence, valuation, integration, and deal structure. Use when evaluating acquisitions, preparing for acquisition, M&A due diligence, integration planning, or deal negotiation.",
	},
	{
		name: "postmortem",
		path: "c-level-advisor/executive-mentor/skills/postmortem/SKILL.md",
		collection: "leadership",
		description:
			"Honest analysis of what went wrong. Use after a failed launch, missed quarter, or bad hire to run a blameless 5-Whys retrospective with a change register — e.g. dissecting why the Q3 release slipped six weeks.",
	},
	{
		name: "scenario-war-room",
		path: "c-level-advisor/skills/scenario-war-room/SKILL.md",
		collection: "leadership",
		description:
			"Cross-functional what-if modeling for cascading multi-variable scenarios. Unlike single-assumption stress testing, this models compound adversity across all business functions simultaneously. Use when facing complex risk scenarios, strategic decisions with major downside, or when the user asks 'what if X AND Y both happen?'",
	},
	{
		name: "strategic-alignment",
		path: "c-level-advisor/skills/strategic-alignment/SKILL.md",
		collection: "leadership",
		description:
			"Cascades strategy from boardroom to individual contributor. Detects and fixes misalignment between company goals and team execution. Covers strategy articulation, cascade mapping, orphan goal detection, silo identification, communication gap analysis, and realignment protocols. Use when teams are pulling in different directions, OKRs don't connect, departments optimize locally at company expense, or when user mentions alignment, strategy cascade, silo, conflicting OKRs, or strategy communication.",
	},
	{
		name: "stress-test",
		path: "c-level-advisor/executive-mentor/skills/stress-test/SKILL.md",
		collection: "leadership",
		description:
			"Business assumption stress testing. Use before betting on a plan whose core assumptions are unvalidated — e.g. stress-testing 'enterprise buyers will tolerate a 6-month pilot' or a hockey-stick revenue model.",
	},
	{
		name: "agile-product-owner",
		path: "product-team/agile-product-owner/skills/agile-product-owner/SKILL.md",
		collection: "product",
		description:
			"Agile product ownership for backlog management and sprint execution. Covers user story writing, acceptance criteria, sprint planning, and velocity tracking. Use when writing user stories, creating acceptance criteria, planning sprints, estimating story points, breaking down epics, or prioritizing the backlog.",
	},
	{
		name: "competitive-teardown",
		path: "product-team/skills/competitive-teardown/SKILL.md",
		collection: "product",
		description:
			"Analyzes competitor products and companies by synthesizing data from pricing pages, app store reviews, job postings, SEO signals, and social media into structured competitive intelligence. Produces feature comparison matrices scored across 12 dimensions, SWOT analyses, positioning maps, UX audits, pricing model breakdowns, action item roadmaps, and stakeholder presentation templates. Use when conducting competitor analysis, comparing products against competitors, researching the competitive landscape, building battle cards for sales, preparing for a product strategy or roadmap session, responding to a competitor's new feature or pricing change, or performing a quarterly competitive review.",
	},
	{
		name: "experiment-designer",
		path: "product-team/skills/experiment-designer/SKILL.md",
		collection: "product",
		description:
			"Use when planning product experiments, writing testable hypotheses, estimating sample size, prioritizing tests, or interpreting A/B outcomes with practical statistical rigor.",
	},
	{
		name: "product-analytics",
		path: "product-team/skills/product-analytics/SKILL.md",
		collection: "product",
		description:
			"Use when defining product KPIs, building metric dashboards, running cohort or retention analysis, or interpreting feature adoption trends across product stages.",
	},
	{
		name: "product-discovery",
		path: "product-team/skills/product-discovery/SKILL.md",
		collection: "product",
		description:
			"Use when validating product opportunities, mapping assumptions, planning discovery sprints, or testing problem-solution fit before committing delivery resources.",
	},
	{
		name: "product-manager-toolkit",
		path: "product-team/skills/product-manager-toolkit/SKILL.md",
		collection: "product",
		description:
			"Comprehensive toolkit for product managers including RICE prioritization, customer interview analysis, PRD templates, discovery frameworks, and go-to-market strategies. Use when prioritizing features, synthesizing user research, writing requirement documentation, or developing product strategy.",
	},
	{
		name: "product-strategist",
		path: "product-team/skills/product-strategist/SKILL.md",
		collection: "product",
		description:
			"Strategic product leadership toolkit for Head of Product covering OKR cascade generation, quarterly planning, competitive landscape analysis, product vision documents, and team scaling proposals. Use when creating quarterly OKR documents, defining product goals or KPIs, building product roadmaps, running competitive analysis, drafting team structure or hiring plans, aligning product strategy across engineering and design, or generating cascaded goal hierarchies from company to team level.",
	},
	{
		name: "roadmap-communicator",
		path: "product-team/skills/roadmap-communicator/SKILL.md",
		collection: "product",
		description:
			"Use when preparing roadmap narratives, release notes, changelogs, or stakeholder updates tailored for executives, engineering teams, and customers.",
	},
	{
		name: "ux-researcher-designer",
		path: "product-team/skills/ux-researcher-designer/SKILL.md",
		collection: "product",
		description:
			"UX research and design toolkit for Senior UX Designer/Researcher including data-driven persona generation, journey mapping, usability testing frameworks, and research synthesis. Use when conducting user research, creating personas, mapping user journeys, planning usability tests, or validating designs.",
	},
	{
		name: "confluence-expert",
		path: "project-management/skills/confluence-expert/SKILL.md",
		collection: "project-management",
		description:
			"Atlassian Confluence expert for creating and managing spaces, knowledge bases, and documentation. Configures space permissions and hierarchies, creates page templates with macros, sets up documentation taxonomies, designs page layouts, and manages content governance. Use when users need to build or restructure a Confluence space, design page hierarchies with permission structures, author or standardise documentation templates, embed Jira reports in pages, run knowledge base audits, or establish documentation standards and collaborative workflows.",
	},
	{
		name: "jira-expert",
		path: "project-management/skills/jira-expert/SKILL.md",
		collection: "project-management",
		description:
			"Atlassian Jira expert for creating and managing projects, planning, product discovery, JQL queries, workflows, custom fields, automation, reporting, and all Jira features. Use when setting up or configuring Jira projects, writing JQL and advanced searches, creating dashboards, designing workflows, or performing technical Jira operations.",
	},
	{
		name: "meeting-analyzer",
		path: "project-management/skills/meeting-analyzer/SKILL.md",
		collection: "project-management",
		description:
			"Analyzes meeting transcripts and recordings to surface behavioral patterns, communication anti-patterns, and actionable coaching feedback. Use for meeting transcript review, speaking ratio analysis, filler words, conflict avoidance, and communication habits over time.",
	},
	{
		name: "scrum-master",
		path: "project-management/skills/scrum-master/SKILL.md",
		collection: "project-management",
		description:
			"Advanced Scrum Master skill for data-driven agile team analysis and coaching. Use when the user asks about sprint planning, velocity tracking, retrospectives, standup facilitation, backlog grooming, story points, burndown charts, blocker resolution, or agile team health. Runs Python scripts to analyse sprint JSON exports from Jira or similar tools: velocity_analyzer.py for Monte Carlo sprint forecasting, sprint_health_scorer.py for multi-dimension health scoring, and retrospective_analyzer.py for action-item and theme tracking. Produces confidence-interval forecasts, health grade reports, and improvement-velocity trends for high-performing Scrum teams.",
	},
	{
		name: "senior-pm",
		path: "project-management/skills/senior-pm/SKILL.md",
		collection: "project-management",
		description:
			"Senior Project Manager for enterprise software, SaaS, and digital transformation projects. Specializes in portfolio management, quantitative risk analysis, resource optimization, stakeholder alignment, and executive reporting. Uses advanced methodologies including EMV analysis, Monte Carlo simulation, WSJF prioritization, and multi-dimensional health scoring. Use when a user needs help with project plans, project status reports, risk assessments, resource allocation, project roadmaps, milestone tracking, team capacity planning, portfolio health reviews, program management, or executive-level project reporting — especially for enterprise-scale initiatives with multiple workstreams, complex dependencies, or multi-million dollar budgets.",
	},
	{
		name: "team-communications",
		path: "project-management/skills/team-communications/SKILL.md",
		collection: "project-management",
		description:
			'Write internal company communications — 3P updates (Progress/Plans/Problems), company-wide newsletters, FAQ roundups, incident reports, leadership updates, status reports, project updates, and general internal comms. Use this skill any time the user asks to draft, edit, or format something meant for internal audiences. Trigger on keywords like "3P", "weekly update", "newsletter", "FAQ", "internal comms", "status report", "company update", "team update", "incident report", or any request to summarize work for leadership, teammates, or the broader company. Even casual requests like "write my update" or "summarize what my team did this week" should trigger this skill.',
	},
	{
		name: "capacity-planner",
		path: "business-operations/skills/capacity-planner/SKILL.md",
		collection: "business-operations",
		description:
			"Use when an ops leader (Director of CX, Head of Support, VP Ops, Head of BizOps, Head of IT ops, Head of Finance ops) is sizing ops capacity, building a headcount plan, modeling utilization risk, planning Q3 capacity or annual support capacity, or designing CS coverage — and needs Erlang-C queueing math, P90 demand sizing, shrinkage-adjusted FTE, manager-trigger thresholds, and a quarterly hiring sequence with ramp + attrition. Apply when sustained team utilization is above 80% or when the team is growing >50% in 12 months. Run before committing the headcount budget. This is NOT engineering capacity (see vpe-advisor for DORA + cycle time) and NOT strategic 3-year workforce planning (see chro-advisor).",
	},
	{
		name: "process-mapper",
		path: "business-operations/skills/process-mapper/SKILL.md",
		collection: "business-operations",
		description:
			"Use when a BizOps lead, COO, or process-improvement owner needs to document an end-to-end business process (procurement, employee onboarding, incident handoff, customer-onboarding, claims adjudication) in BPMN-style notation, measure cycle times by stage, surface where work spends most of its time waiting vs. being worked, and quantify the gap between processing time and total elapsed time. Pairs Lean / Six Sigma / Theory-of-Constraints canon with deterministic stdlib-only Python tools to produce a process map, a ranked bottleneck list (with severity + root-cause hypothesis), and a cycle-time analysis (P50, P90, value-add ratio, Little's-Law throughput). Distinct from sales-pipeline, system-reliability (SLO), and strategic-OKR work — this is tactical process documentation for internal operations.",
	},
	{
		name: "procurement-optimizer",
		path: "business-operations/skills/procurement-optimizer/SKILL.md",
		collection: "business-operations",
		description:
			'Use when running an annual SaaS audit, doing category-level spend review, or rationalizing the supplier base — when the user needs a spend audit, spend categorization (UNSPSC-aligned with Pareto breakdown and industry profiles), purchasing-cycle analysis (bottleneck categories per Goldratt\'s Theory of Constraints), or risk-balanced supplier consolidation that refuses single-source recommendations for tier-1 categories without a documented break-glass plan. Triggers on "spend audit", "SaaS audit", "spend categorization", "supplier rationalization", "supplier consolidation", "category strategy", "duplicate SaaS", "renewal cluster".',
	},
	{
		name: "vendor-management",
		path: "business-operations/skills/vendor-management/SKILL.md",
		collection: "business-operations",
		description:
			'Use when reviewing, scoring, or auditing third-party SaaS / vendor relationships — running a vendor scorecard with industry tuning, tracking SLA compliance with credit-claim flags, classifying third-party risk across 4 risk vectors, preparing a tier-1 vendor review, or auditing the SaaS portfolio. Forks context so large vendor catalogs (50-500 line items) and SLA logs don\'t pollute the parent thread. Triggers on "vendor SLA", "vendor scorecard", "third-party risk", "TPRM", "vendor review", "supplier performance", "vendor health check", "renewal review".',
	},
	{
		name: "business-investment-advisor",
		path: "finance/business-investment-advisor/skills/business-investment-advisor/SKILL.md",
		collection: "finance",
		description:
			"Business investment analysis and capital allocation advisor. Use when evaluating whether to invest in equipment, real estate, a new business, hiring, technology, or any capital expenditure. Also use for ROI calculations, IRR, NPV, payback period, build vs buy decisions, lease vs buy analysis, vendor evaluation, or deciding where to allocate limited budget for maximum return.",
	},
	{
		name: "financial-analyst",
		path: "finance/skills/financial-analyst/SKILL.md",
		collection: "finance",
		description:
			"Performs financial ratio analysis, DCF valuation, budget variance analysis, and rolling forecast construction for strategic decision-making. Use when analyzing financial statements, building valuation models, assessing budget variances, or constructing financial projections and forecasts. Also applicable when users mention financial modeling, cash flow analysis, company valuation, financial projections, or spreadsheet analysis.",
	},
	{
		name: "saas-metrics-coach",
		path: "finance/skills/saas-metrics-coach/SKILL.md",
		collection: "finance",
		description:
			"SaaS financial health advisor. Use when a user shares revenue or customer numbers, or mentions ARR, MRR, churn, LTV, CAC, NRR, or asks how their SaaS business is doing.",
	},
	{
		name: "capa-officer",
		path: "ra-qm-team/skills/capa-officer/SKILL.md",
		collection: "compliance",
		description:
			"CAPA system management for medical device QMS. Covers root cause analysis, corrective action planning, effectiveness verification, and CAPA metrics. Use when running CAPA investigations, 5-Why analysis, fishbone diagrams, root cause determination, corrective action tracking, effectiveness verification, or CAPA program optimization.",
	},
	{
		name: "eu-ai-act-specialist",
		path: "ra-qm-team/skills/eu-ai-act-specialist/SKILL.md",
		collection: "compliance",
		description:
			"EU AI Act (Regulation (EU) 2024/1689) operational compliance for compliance teams. Three Article-level decisions: (1) What's the risk tier of this AI system — prohibited (Art. 5), high-risk (Art. 6 + Annex III), limited-risk (Art. 50), or minimal-risk? (2) For high-risk systems, what's the Article 43 conformity assessment route (Module A internal control vs Module H full QMS + notified body) and what goes in the Annex IV technical documentation? (3) Per organizational role (provider / deployer / importer / distributor / authorized representative), what are the active obligations and deadlines? Use during AI system intake review, when planning conformity assessment, or when scoping deployer obligations. Cites Articles + Annexes for every output. NOT executive AI strategy (see chief-ai-officer-advisor). NOT a legal substitute.",
	},
	{
		name: "gdpr-dsgvo-expert",
		path: "ra-qm-team/skills/gdpr-dsgvo-expert/SKILL.md",
		collection: "compliance",
		description:
			"GDPR and German DSGVO compliance automation. Scans codebases for privacy risks, generates DPIA documentation, tracks data subject rights requests with Art. 12(3) one-month deadlines. Use when running GDPR compliance assessments, privacy audits, data protection planning, DPIA generation, or data subject rights (DSAR) management (e.g., 'check this service for GDPR risks', 'track an access request deadline'). Final compliance determinations route to the DPO or legal counsel.",
	},
	{
		name: "information-security-manager-iso27001",
		path: "ra-qm-team/skills/information-security-manager-iso27001/SKILL.md",
		collection: "compliance",
		description:
			"ISO 27001 ISMS implementation and cybersecurity governance for HealthTech and MedTech companies. Use when designing an ISMS, running security risk assessments, implementing controls, pursuing ISO 27001 certification, preparing security audits, responding to security incidents, or verifying compliance. Covers ISO 27001, ISO 27002, healthcare security, and medical device cybersecurity.",
	},
	{
		name: "isms-audit-expert",
		path: "ra-qm-team/skills/isms-audit-expert/SKILL.md",
		collection: "compliance",
		description:
			"Information Security Management System (ISMS) audit expert for ISO 27001 compliance verification, security control assessment, and certification support. Use when the user mentions ISO 27001, ISMS audit, Annex A controls, Statement of Applicability (SOA), gap analysis, nonconformity management, internal audit, surveillance audit, or security certification preparation. Helps review control implementation evidence, document audit findings, classify nonconformities, generate risk-based audit plans, map controls to Annex A requirements, prepare Stage 1 and Stage 2 audit documentation, and support corrective action workflows.",
	},
	{
		name: "quality-manager-qms-iso13485",
		path: "ra-qm-team/skills/quality-manager-qms-iso13485/SKILL.md",
		collection: "compliance",
		description:
			"ISO 13485 Quality Management System implementation and maintenance for medical device organizations. Provides QMS design, documentation control, internal auditing, CAPA management, and certification support. Use when working with medical device quality systems, preparing for ISO 13485 audits, managing regulatory compliance documentation, setting up corrective actions, or building audit preparation programs. Useful for quality management, audit preparation, regulatory compliance, medical device documentation, and corrective action workflows.",
	},
	{
		name: "regulatory-affairs-head",
		path: "ra-qm-team/skills/regulatory-affairs-head/SKILL.md",
		collection: "compliance",
		description:
			"Senior Regulatory Affairs Manager for HealthTech and MedTech companies. Prepares FDA 510(k), De Novo, and PMA submission packages; analyzes regulatory pathways for new medical devices; drafts responses to FDA deficiency letters and Notified Body queries; develops CE marking technical documentation under EU MDR 2017/745; coordinates multi-market approval strategies across FDA, EU, Health Canada, PMDA, and NMPA; and maintains regulatory intelligence on evolving standards. Use when users need to plan or execute FDA submissions, navigate 510(k) or PMA approval processes, achieve CE marking, prepare pre-submission meeting materials, write regulatory strategy documents, respond to agency queries, or manage compliance documentation for medical device market access.",
	},
	{
		name: "risk-management-specialist",
		path: "ra-qm-team/skills/risk-management-specialist/SKILL.md",
		collection: "compliance",
		description:
			"Medical device risk management specialist implementing ISO 14971 throughout product lifecycle. Provides risk analysis, risk evaluation, risk control, and post-production information analysis. Use when user mentions risk management, ISO 14971, risk analysis, FMEA, fault tree analysis, hazard identification, risk control, risk matrix, benefit-risk analysis, residual risk, risk acceptability, or post-market risk.",
	},
	{
		name: "soc2-compliance",
		path: "ra-qm-team/skills/soc2-compliance/SKILL.md",
		collection: "compliance",
		description:
			"Use when the user asks to prepare for SOC 2 audits, map Trust Service Criteria, build control matrices, collect audit evidence, perform gap analysis, or assess SOC 2 Type I vs Type II readiness.",
	},
	{
		name: "deepread",
		path: "research/deepread/SKILL.md",
		collection: "research",
		description:
			"Use when the user asks to deeply read a book, article, PDF, or document set; extract claims and evidence; build a knowledge map; or learn through Feynman explanation and recall. Covers quick, deep, map, Feynman, and whole-book reading modes.",
	},
	{
		name: "dossier",
		path: "research/dossier/skills/dossier/SKILL.md",
		collection: "research",
		description:
			"Decision-grade entity research skill — produces a hypothesis-tested dossier on a specific company, person, nonprofit, or government org, not a generic profile. Forcing intake makes the user state their hypothesis upfront (what they already believe and want to verify or disprove) so the dossier tests it rather than confirms it. Output is an editable Word document (.docx) with verdict on the hypothesis, identity facts, 12-month activity timeline, network and reputation signals, red flags, conversation hooks tied to specific findings, and source-provenance audit log. Uses WebSearch + WebFetch + free APIs (SEC EDGAR, GitHub, ProPublica) as workhorses; optional BYOK MCPs enhance coverage. Use when the user asks for background research, diligence, or meeting prep on a specific entity (e.g., 'prep me for a meeting with [person/company]', 'due diligence on [company]'). Honors sensitivity exclusions for journalism + personal-vetting contexts.",
	},
	{
		name: "litreview",
		path: "research/litreview/skills/litreview/SKILL.md",
		collection: "research",
		description:
			"Academic literature orientation skill that searches papers via free keyless APIs (PubMed E-utilities + OpenAlex) by default — with the Consensus MCP as an optional enhancement lane when connected — builds a strategic search plan using PICO (default) or SPIDER / Decomposition / hybrid as fallbacks, and synthesizes findings into a formatted Word (.docx) research guide. Grill-me intake (research question specificity + framework hint + tentative depth) before the recon search; a second forcing checkpoint after Phase 2 confirms framework + sub-areas + depth before searches consume budget. Configurable depth (5/10/20 queries) controls coverage vs. speed. Output is a 'launching pad' — an orientation guide that lets a researcher dive in confidently, not a finished review. Use when the user starts literature-oriented research (e.g., 'litreview on [topic]', 'literature review on [topic]', 'I'm starting a literature review on X', 'I'm writing a paper on X', 'help me research X', 'I'm doing research on X', 'can you help me research X'). Do NOT use for single one-off paper searches wanting a quick list — that's a plain PubMed/OpenAlex (or Consensus) query.",
	},
	{
		name: "market-research",
		path: "research-ops/skills/market-research/SKILL.md",
		collection: "research",
		description:
			"Use when doing upstream market-research methodology — sizing a market as TAM/SAM/SOM computed BOTH top-down and bottoms-up (never a single unsourced number), planning a survey sample size with finite-population correction and per-segment minimums, or scoring candidate market segments against Kotler's measurable/substantial/accessible/differentiable/actionable criteria. Outputs always show the method and the assumptions. For market-research analysts and product-marketing at the sizing/survey/segmentation moment. Distinct from marketing-skill (campaign analytics, attribution, demand-gen) — this is the evidence-building methodology, not live-campaign optimization.",
	},
	{
		name: "meetings",
		path: "productivity/meetings/skills/meetings/SKILL.md",
		collection: "productivity",
		description:
			'Use when someone wants to decide whether a meeting is worth calling, price a meeting in dollars, build a timeboxed agenda with desired outcomes, or turn messy meeting notes into owned action items — or says "should this be a meeting", "/cs:meeting-prep", or "/cs:meeting-actions". Runs a cost gate (ASYNC / NOT-READY / MEET), builds a decision-first agenda, and extracts an owner + due-date checklist that flags every orphan.',
	},
	{
		name: "reflect",
		path: "productivity/reflect/skills/reflect/SKILL.md",
		collection: "productivity",
		description:
			"Mid-conversation reflection skill that pauses execution and zooms out from detail-mode to honestly reassess direction, assumptions, and bias. Use when the user says 'reflect', 'take a step back', 'step back', 'zoom out', 'are we missing something', 'bigger picture', 'sanity check this', 'are we on track', 'are we overthinking this', 'forest for the trees', or any variation signaling intent to break out of detail-mode and reassess. Also trigger when the conversation has gone deep on implementation details without strategic check-in, or when the user shows signs of being stuck — that's often a signal the framing needs a reset, not more detail work. Intentionally low-intake: runs the 5-dimension analysis immediately when prior context is rich enough; asks one forcing clarifier only when invocation context is too thin to reassess from.",
	},
	{
		name: "weekly-review",
		path: "productivity/weekly-review/skills/weekly-review/SKILL.md",
		collection: "productivity",
		description:
			'Use when someone wants to run a weekly review, close open loops, audit stalled projects and commitments, get their system back to trusted, restart a lapsed review habit, or says "/cs:weekly-review". Walks David Allen\'s three-phase loop — GET CLEAR, GET CURRENT, GET CREATIVE — with deterministic scripts that inventory open loops, gate the checklist with named gaps, and score commitment health 0-100.',
	},
];

export const ALIREZAREZVANI_DEFAULT_SKILLS: DefaultSkillManifestEntry[] =
	ALIREZAREZVANI_SKILL_SOURCES.map(
		({ name, path, collection, description }) => ({
			name,
			description,
			publisher: "Alireza Rezvani",
			collection,
			repo: REPO,
			sourceUrl: `${SOURCE_ROOT}/${path}`,
			rawUrl: `${RAW_ROOT}/${path}`,
		}),
	);
