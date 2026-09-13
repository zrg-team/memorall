import { stepRegistry } from "../../registries/step-registry.js";
import { defineStep, bindStep } from "../../interfaces/engine/step.js";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/engine/step.js";
import type { ChatMessage } from "../../interfaces/engine/messages.js";

export const CURRENT_TIME_STEP_NAME = "current-time" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

interface Input {
	messages: ChatMessage[];
}

interface Output {
	reminders?: string[];
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

		// A clock is the textbook cache invalidator: it differs on every
		// request. Handing it back as a reminder keeps it out of the
		// conversation prefix entirely, so it is re-read at full price and
		// nothing behind it is.
		return { output: { reminders: [content] } };
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

const createStep: StepFactoryFromSpec<Spec> = (
	services: Services,
	config?: CurrentTimeConfig,
) => bindStep(definition, services, config);

stepRegistry.register(CURRENT_TIME_STEP_NAME, createStep, {
	description:
		"Inject the current date and time as a system reminder, past the cached prefix",
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
	feature: {
		id: "step-current-time",
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
				name: "reminders",
				type: "string[]",
				description:
					"Current date & time, attached past the end of the cached prefix.",
			},
		],
		volatile: true,
	},
});

declare global {
	interface StepTypeRegistry {
		[CURRENT_TIME_STEP_NAME]: Spec;
	}
}
