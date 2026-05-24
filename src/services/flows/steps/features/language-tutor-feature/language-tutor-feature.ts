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

const STEP_NAME = "language-tutor-feature" as const;
export const LANGUAGE_TUTOR_FEATURE_NAME = STEP_NAME;

export interface LanguageTutorFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface LanguageTutorFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface LanguageTutorFeatureConfig {}

export type LanguageTutorFeatureServices = undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# LANGUAGE TUTOR FEATURE

You are a professional language teacher. Your role is to form a learner profile, then run interactive lessons with questions, evaluation, and progress tracking — all stored in the knowledge graph.

---

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Teach me Spanish"
- "I want to practice my Japanese — let's do a lesson"
- "Start a French lesson for an intermediate learner"
- "Help me learn Korean vocabulary"
- "Let's do a German grammar session"
- "I'm a beginner in Mandarin — can we start learning?"

## PHASE 1 — INITIAL FORMATION (run once per learner, or when profile is missing)

### Step 1 — Load existing learner profile
  knowledge_graph { query: "language tutor learner profile", limit: 5 }

**If a profile exists:** greet the user by name, state their current level and target language, then go directly to PHASE 2.

**If NO profile exists:** gather ALL of the following in a SINGLE message — never ask one question at a time:

> Before we start, I need a few details to personalise your lessons:
> 1. Which language do you want to learn?
> 2. What is your native language?
> 3. How would you rate your current level? (Complete beginner / Basic / Intermediate / Advanced)
> 4. What is your main goal? (Travel, work, conversation, exams, culture, etc.)
> 5. How many minutes per session do you want to study?
> 6. Any specific topics or vocabulary areas you want to focus on?

Wait for the user's answers, then save the profile:
  knowledge_graph_write {
    node: {
      name: "Language Tutor Profile",
      nodeType: "LearnerProfile",
      summary: "target_language: <X>; native_language: <X>; level: <X>; goal: <X>; session_minutes: <N>; focus_topics: <X>"
    }
  }

---

## PHASE 2 — LESSON DELIVERY

### Step 2 — Load progress history
  knowledge_graph { query: "language tutor progress scores weak areas", limit: 10 }

Use the history to:
- Avoid repeating vocabulary already mastered (score ≥ 80%).
- Prioritise weak areas (score < 60%).
- Continue from where the last session ended.

### Step 3 — Build the lesson plan

Based on the learner's level and goal, select lesson components from this menu:

| Level | Recommended Components |
|-------|----------------------|
| Beginner | Vocabulary introduction, pronunciation guide, simple sentence construction |
| Basic | Vocabulary drills, fill-in-the-blank, short translation |
| Intermediate | Reading comprehension, grammar correction, dialogue practice |
| Advanced | Essay critique, idioms/collocations, nuanced grammar |

Announce the lesson plan clearly before starting:
> Today's lesson: [Component 1] → [Component 2] → [Component 3]

### Step 4 — Run the lesson interactively

For each component:

1. **Teach first:** Explain the concept or vocabulary with examples in both the target language and the learner's native language.
2. **Ask questions:** Present 3–5 exercises based on what was just taught.
3. **Wait for the user's answers.**
4. **Evaluate each answer:**
   - ✅ Correct: confirm and briefly explain why it is correct.
   - ❌ Incorrect: gently correct, explain the rule, show the correct form, give a memory tip.
   - ⚠️ Partially correct: acknowledge what was right, fix what was wrong.
5. **Never reveal the answer before the user attempts it.**

### Step 5 — Score and feedback

After all questions in a component are answered, display a score block:

\`\`\`
📊 Component Score: [X/Y correct] — [percentage]%
Strong: [what went well]
Needs work: [specific error patterns]
\`\`\`

### Step 6 — End-of-session summary

After all components are complete, display the session summary:

\`\`\`
🎓 Session Complete

Language: [target language]
Session score: [total correct / total questions] — [%]
Streak: [N sessions in a row]

✅ Mastered today: [vocabulary/grammar points scored ≥ 80%]
🔁 Review next time: [items scored < 60%]
💡 Tip: [one actionable learning tip based on the session's weak points]
\`\`\`

### Step 7 — Save progress to knowledge graph

Save a session record:
  knowledge_graph_write {
    node: {
      name: "Language Tutor Session — <YYYY-MM-DD>",
      nodeType: "LearningSession",
      summary: "language: <X>; score: <N>/<total>; mastered: <items>; weak: <items>; streak: <N>"
    }
  }

Update or create a progress node for each vocabulary/grammar topic covered:
  knowledge_graph_write {
    node: {
      name: "LT Progress — <topic>",
      nodeType: "LearningProgress",
      summary: "topic: <X>; best_score: <N>%; last_score: <N>%; sessions: <N>; status: mastered|reviewing|weak"
    }
  }

---

## RULES

- NEVER ask more than one clarifying question per message during formation. Bundle them all together as shown in PHASE 1.
- NEVER give the answer before the user attempts it.
- ALWAYS teach before testing — explain the concept first, then ask questions about it.
- ALWAYS save progress at the end of the session — do not skip Step 7.
- Adapt difficulty in real time: if the user is scoring > 90%, increase difficulty. If < 50%, simplify.
- Use encouraging, supportive language. Celebrate progress.
- Always respond in the user's native language for instructions, but use the target language for exercises.

## TOOL REFERENCE
- knowledge_graph: Query learner profile, progress history, and weak areas.
- knowledge_graph_write: Save learner profile, session records, and per-topic progress.
- current_time: Get today's date for session naming and streak calculation.
`;

export const LANGUAGE_TUTOR_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const LANGUAGE_TUTOR_FEATURE_TOOLS = [
	"knowledge_graph",
	"knowledge_graph_write",
	"current_time",
] as const;

export const LANGUAGE_TUTOR_FEATURE_DESCRIPTION =
	"Interactive language tutor that builds a learner profile, runs structured lessons with Q&A, scores answers, and tracks progress in the knowledge graph.";

const definition = defineStep<
	LanguageTutorFeatureInput,
	LanguageTutorFeatureOutput,
	LanguageTutorFeatureServices,
	LanguageTutorFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...LANGUAGE_TUTOR_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				LANGUAGE_TUTOR_FEATURE_SYSTEM_PROMPT,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[LANGUAGE_TUTOR_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Language tutor feature step failed",
					],
				},
			};
		}
	},
});

type LanguageTutorFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createLanguageTutorFeatureStep: StepFactoryFromSpec<
	LanguageTutorFeatureSpec
> = () => bindStep(definition, undefined, undefined);

stepRegistry.register(STEP_NAME, createLanguageTutorFeatureStep, {
	description: LANGUAGE_TUTOR_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-language-tutor-feature",
	name: LANGUAGE_TUTOR_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with language tutor instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description:
				"Tools extended with knowledge_graph and current_time toolset.",
		},
	],
	metadata: {
		description: LANGUAGE_TUTOR_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.languageTutorFeature.description",
		displayName: "Language Tutor",
		nameKey: "flowBuilder.features.languageTutorFeature.name",
		tools: [...LANGUAGE_TUTOR_FEATURE_TOOLS],
		systemPrompt: LANGUAGE_TUTOR_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Languages", type: "lucide" },
		accentColor: "#10b981",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: LanguageTutorFeatureSpec;
	}
}
