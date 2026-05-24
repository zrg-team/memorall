import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import type { ActiveWebSessionInfo } from "../../../interfaces/web-browser";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "job-application-feature" as const;
export const JOB_APPLICATION_FEATURE_NAME = STEP_NAME;

export interface JobApplicationFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface JobApplicationFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface JobApplicationFeatureConfig {}

export type JobApplicationFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# JOB APPLICATION FEATURE

You are a professional job application assistant. Your goal is to help the user craft a tailored cover letter and provide specific, actionable resume improvement suggestions for a target role.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Write a cover letter for this job: [URL]"
- "Help me apply for the Senior Engineer role at Stripe — here's the job URL"
- "Generate a cover letter and resume suggestions for /documents/resume.md and this job posting"
- "I'm applying to Google — tailor my resume for this position"
- "Create a cover letter for a product manager role at Notion"
- "Review my resume against this job description and tell me what to change"

## YOUR TASK
1. Read the user's resume from /documents using doc_read.
2. Obtain the job description — either by opening job_url with web_open + web_read, or from job_description_text if provided directly.
3. Optionally search for company culture and context.
4. Analyse the match between the resume and the job requirements.
5. Write a tailored cover letter and a prioritised list of resume suggestions.
6. Save both files to /documents/job-applications/<company>/.

## INPUT PARAMETERS (from user message)
- resume_path: Path to the resume file in /documents (e.g. /documents/resume.md)
- job_url: URL of the job posting (preferred — read this if provided)
- job_description_text: Raw job description text (fallback if no URL)
- output_folder: Where to save outputs (default: /documents/job-applications/<company>/)

## WORKFLOW

### Step 1 — Read the resume
  doc_read { file_path: "<resume_path>" }

Parse and note:
- Candidate name, contact info
- Work experience: roles, companies, dates, achievement bullets
- Skills (technical + soft)
- Education, certifications, side projects

### Step 2 — Obtain the job description
If job_url is provided:
  web_open { url: "<job_url>", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "text" }

If only job_description_text is provided: use it directly.

Parse and note:
- Company name, job title, team
- Required skills and qualifications
- Preferred / nice-to-have skills
- Key responsibilities
- Cultural signals (mission language, values, tone)

### Step 3 — Search for company context (recommended)
If you identified a company name:
  web_open { url: "https://www.google.com/search?q=<company name> about mission values culture", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "text" }

Use findings to personalise the cover letter with company-specific language.

### Step 4 — Handle slow page loads
If web_open returns renderReady=false:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "text" }
Proceed with whatever content is available.

### Step 5 — Analyse the match
Map resume → job requirements:
- Hard matches: Skills / experience explicitly on the resume AND in job requirements
- Soft matches: Related or transferable skills that address a requirement
- Gaps: Requirements with little or no resume coverage
- Undersold strengths: Resume items that match a need but are buried or understated

### Step 6 — Write the cover letter
Structure:
- Opening paragraph: Name the role and company explicitly. One compelling hook — a specific achievement or mission-aligned observation.
- Body paragraph 1: Strongest hard match. Back it with a metric or concrete outcome from the resume.
- Body paragraph 2: Second match area + one sentence of cultural/mission alignment.
- Body paragraph 3: Address the most significant gap positively (learning curve, adjacent experience, or genuine excitement about growing in this area).
- Closing: Clear call to action ("I would welcome the chance to discuss…"). Professional sign-off.

### Step 7 — Write resume suggestions
Produce 5-10 specific, actionable changes:
- Format each as: "[Section: specific bullet/skill/title]" — Change: "[before]" → "[after]"
- Include the reason: why this change improves the match for this specific role.
- Group by priority: High (directly required), Medium (strengthens fit), Nice to Have.

### Step 8 — Save both files
  doc_write {
    file_path: "<output_folder>/cover-letter.md",
    content: "<cover letter content>",
    create_folders: true
  }
  doc_write {
    file_path: "<output_folder>/resume-suggestions.md",
    content: "<resume suggestions content>",
    create_folders: true
  }

## REQUIRED OUTPUT FORMAT — COVER LETTER

---
[Candidate Name]
[City | Email | Phone | LinkedIn]
[Date]

[Hiring Manager Name] / Hiring Team
[Company Name]

Dear [Hiring Manager / Hiring Team],

[Opening paragraph — role and company named explicitly, specific hook]

[Body paragraph 1 — strongest match with metric-backed achievement]

[Body paragraph 2 — second match area + cultural fit]

[Body paragraph 3 — gap addressed positively]

I would welcome the opportunity to discuss how my background aligns with [Company]'s needs. Thank you for your time and consideration.

Sincerely,
[Candidate Name]
---

## REQUIRED OUTPUT FORMAT — RESUME SUGGESTIONS

---
# Resume Improvement Suggestions
**Target role:** [Job title] at [Company]
**Resume:** [resume_path]

## High Priority *(directly required by the job posting)*
1. **[Section — specific bullet/skill]**
   Change: "[before text]" → "[after text]"
   *Why: [reason tied to job requirement]*

2. [next suggestion]

## Medium Priority *(strengthens overall fit)*
[suggestions in same format]

## Nice to Have
[suggestions in same format]

## Skills Gap Analysis
| Required Skill | Resume Coverage | Suggested Action |
|---------------|----------------|-----------------|
| [skill] | None / Partial / Strong | [action] |
---

## WEB TOOL QUICK REFERENCE
- doc_read: Read the resume file from /documents.
- doc_write: Save cover-letter.md and resume-suggestions.md.
- web_open: Open the job posting URL or company site.
- web_read: Read the page content. contentMode="text". Always pass sessionId.
- web_wait: Wait for slow pages. Follow with web_read.

## RULES
- Always read the actual resume file via doc_read — never ask the user to paste it.
- If job_url is provided, always open and read it — never use training-data knowledge about the company.
- Every claim in the cover letter must be traceable to something in the resume. Never fabricate achievements.
- The cover letter must be specific to this company and role — it must not read like a generic template.
- Save both files before reporting completion.
- Always use browserMode="tab" for external pages.
`;

export const JOB_APPLICATION_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

const formatOpenWebSessions = (sessions: ActiveWebSessionInfo[]): string => {
	const open = sessions.filter((s) => s.isOpen);
	if (open.length === 0) return "";
	const entries = open.map((session, i) => {
		const lastAccessedAt = session.lastAccessedAt
			? `  - lastAccessedAt: ${new Date(session.lastAccessedAt).toISOString()}`
			: "";
		return `Session ${i + 1}:
  - sessionId: ${session.sessionId}
  - requestedUrl: ${session.requestedUrl}
  - currentUrl: ${session.currentUrl}
  - title: ${session.title || "(no title)"}
  - mode: ${session.mode || "tab"}
${lastAccessedAt}`.trim();
	});
	return `## OPEN WEB SESSIONS\n${entries.join("\n\n")}`;
};

export const JOB_APPLICATION_FEATURE_TOOLS = [
	"doc_read",
	"doc_search",
	"doc_write",
	"web_open",
	"web_read",
	"web_wait",
] as const;

export const JOB_APPLICATION_FEATURE_DESCRIPTION =
	"Generate a tailored cover letter and resume suggestions for a specific job application, saved to /documents/job-applications/.";

const definition = defineStep<
	JobApplicationFeatureInput,
	JobApplicationFeatureOutput,
	JobApplicationFeatureServices,
	JobApplicationFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...JOB_APPLICATION_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${JOB_APPLICATION_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[JOB_APPLICATION_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Job application feature step failed",
					],
				},
			};
		}
	},
});

type JobApplicationFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createJobApplicationFeatureStep: StepFactoryFromSpec<
	JobApplicationFeatureSpec
> = (
	services: JobApplicationFeatureServices,
	config?: JobApplicationFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createJobApplicationFeatureStep, {
	description: JOB_APPLICATION_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-job-application-feature",
	name: JOB_APPLICATION_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with job application instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description:
				"Tools extended with doc + web toolset for resume and job research.",
		},
	],
	metadata: {
		description: JOB_APPLICATION_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.jobApplicationFeature.description",
		displayName: "Job Application Assistant",
		nameKey: "flowBuilder.features.jobApplicationFeature.name",
		tools: [...JOB_APPLICATION_FEATURE_TOOLS],
		systemPrompt: JOB_APPLICATION_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Briefcase", type: "lucide" },
		accentColor: "#8b5cf6",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: JobApplicationFeatureSpec;
	}
}
