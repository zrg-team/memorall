import { defineStep, bindStep } from "@/services/flows/interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows/interfaces/step";
import { stepRegistry } from "@/services/flows/step-registry";
import {
	featureCatalogRegistry,
	type FeatureCatalogMetadata,
} from "@/services/flows/feature-catalog-registry";
import type { ChatMessage } from "@/types/openai";
import { GraphBase } from "@/services/flows/graph/graph.base";

export const CURRENT_TIME_STEP_NAME = "current-time" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

interface Input {
	messages: ChatMessage[];
}

interface Output {
	messages?: ChatMessage[];
}

type Services = Record<string, never>;

export interface CurrentTimeConfig {
	/**
	 * IANA timezone string (e.g. "Asia/Ho_Chi_Minh", "America/New_York").
	 * Defaults to the system local timezone.
	 */
	timezone?: string;
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<Input, Output, Services, CurrentTimeConfig>({
	name: CURRENT_TIME_STEP_NAME,
	execute: async ({ input, config }) => {
		const timezone = config?.timezone;
		const now = new Date();

		const formatted = now.toLocaleString("en-US", {
			...(timezone ? { timeZone: timezone } : {}),
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			timeZoneName: "short",
		});

		const iso = timezone
			? now.toLocaleString("sv-SE", { timeZone: timezone }).replace(" ", "T")
			: now.toISOString();

		const content = `## CURRENT DATE & TIME\n- Now: ${formatted}\n- ISO: ${iso}`;

		const updatedMessages = GraphBase.chat.injectUserContext(
			input.messages ?? [],
			content,
		);

		return { output: { messages: updatedMessages } };
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

const createStep: StepFactoryFromSpec<Spec> = (
	services: Services,
	config?: CurrentTimeConfig,
) => bindStep(definition, services, config);

stepRegistry.register(CURRENT_TIME_STEP_NAME, createStep, {
	description:
		"Inject the current date and time into the system prompt automatically",
	configParams: [
		{
			key: "timezone",
			type: "string",
			default: "",
			description:
				'IANA timezone (e.g. "Asia/Ho_Chi_Minh"). Defaults to system local timezone.',
		},
	],
	defaultStateMapping: { messages: "messages" },
	enabledByDefault: true,
});

featureCatalogRegistry.register({
	id: "step-current-time",
	name: CURRENT_TIME_STEP_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: [
		{
			name: "messages",
			type: "Message[]",
			required: true,
			description: "Current chat messages",
		},
	],
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with current date & time injected into the system prompt.",
		},
	],
	metadata: {
		description:
			"Inject the current date and time into the system prompt automatically",
		displayName: "Current Time",
		tools: [],
		systemPrompt:
			"## CURRENT DATE & TIME\n- Now: <current date & time>\n- ISO: <ISO string>",
		customizable: false,
		icon: { name: "Clock", type: "lucide" },
		accentColor: "#f59e0b",
		volatile: true,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[CURRENT_TIME_STEP_NAME]: Spec;
	}
}
