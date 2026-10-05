import type {
	ToolExecutionContext,
	ToolExecutionResult,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import {
	getConversationScopeKey,
	getRunAgentId,
	RUN_RUNTIME_KEY,
} from "@/services/chat/runtime-keys";
import {
	MEMON_CONFIG_RUNTIME_KEY,
	MEMON_HOME_RUNTIME_KEY,
	type MemonWindowApp,
} from "@/services/memon/constants";
import { normalizeMemonFeatureConfig } from "@/services/memon/feature-config";
import { getMemonMachine } from "@/services/memon/machine-registry";
import { MemonApprovalRequiredError } from "@/services/memon/approval-error";
import type { MemonMachine } from "@/services/memon/memon-machine";

export interface MemonToolStructured {
	ok: boolean;
	action: string;
	summary: string;
	app?: MemonWindowApp | "screen";
	windowId?: string | null;
	revision?: number;
	needsApproval?: "forms" | "installs" | "deletes";
}

/**
 * Machine key for a run: the agent, so its computer outlives switching or
 * starting chats; the conversation when a run has no agent.
 */
const machineKeyFor = (context?: ToolExecutionContext): string =>
	getRunAgentId(context?.runtime) ??
	getConversationScopeKey(context?.runtime) ??
	"default";

type Acquired =
	| { machine: MemonMachine; blocked?: undefined }
	| { machine: MemonMachine; blocked: ToolExecutionResult };

/**
 * Resolves the conversation's computer and waits for the agent's turn: a tool
 * call made while the user drives (or has paused the run) parks here until
 * they resume, press Stop, or the wait ceiling passes.
 */
export const acquireMemonMachine = async (
	action: string,
	context?: ToolExecutionContext,
): Promise<Acquired> => {
	const config = normalizeMemonFeatureConfig(
		context?.runtime?.get(MEMON_CONFIG_RUNTIME_KEY),
	);
	const home = context?.runtime?.get(MEMON_HOME_RUNTIME_KEY);
	const machine = await getMemonMachine(machineKeyFor(context), {
		config,
		agentId: getRunAgentId(context?.runtime),
		// The run's home: after a rename, the computer follows the folder.
		home: typeof home === "string" ? home : undefined,
	});
	const runId = context?.runtime?.get(RUN_RUNTIME_KEY);
	if (typeof runId === "string") machine.beginRun(runId);
	const outcome = await machine.waitForAgentTurn();
	if (outcome === "ready") return { machine };
	const summary =
		outcome === "cancelled"
			? "The user stopped the run while they were using the computer."
			: "The user is still using the computer. Stop here and tell them you will continue when they resume automation.";
	return {
		machine,
		blocked: {
			content: `${summary}\n\n${machine.readScreen()}`,
			structuredContent: {
				ok: false,
				action,
				summary,
				revision: machine.snapshot().revision,
			} satisfies MemonToolStructured,
		},
	};
};

const focusedApp = (machine: MemonMachine): MemonWindowApp | undefined => {
	const snapshot = machine.snapshot();
	return snapshot.windows.find(
		(window) => window.id === snapshot.focusedWindowId,
	)?.app;
};

/** A tool's answer: its summary, and a picture (a data URL) for the model to look at. */
export interface MemonToolOutput {
	summary: string;
	image?: string;
}

/** Every memon_* result: one summary line, then the screen (and a picture). */
export const memonResult = (
	machine: MemonMachine,
	action: string,
	output: string | MemonToolOutput,
): ToolExecutionResult => {
	const { summary, image } =
		typeof output === "string" ? { summary: output, image: undefined } : output;
	const screen = machine.readScreen();
	const snapshot = machine.snapshot();
	const text = `${summary}\n\n${screen}`;
	return {
		// Tool results carry image parts through to the model (pdf_to_image too).
		content: image
			? ([
					{ type: "text", text },
					{ type: "image_url", image_url: { url: image, detail: "auto" } },
				] as unknown as ToolExecutionResult["content"])
			: text,
		structuredContent: {
			ok: true,
			action,
			summary,
			app: focusedApp(machine),
			windowId: snapshot.focusedWindowId,
			revision: snapshot.revision,
		} satisfies MemonToolStructured,
	};
};

export const memonFailure = (
	machine: MemonMachine | undefined,
	action: string,
	error: unknown,
): ToolExecutionResult => {
	const message = error instanceof Error ? error.message : String(error);
	const approval = error instanceof MemonApprovalRequiredError;
	const summary = approval ? `Needs the user's approval: ${message}` : message;
	return {
		content: machine ? `${summary}\n\n${machine.readScreen()}` : summary,
		// An approval gate is not a failure: the model should relay it.
		isError: !approval,
		structuredContent: {
			ok: false,
			action,
			summary,
			app: machine ? focusedApp(machine) : undefined,
			windowId: machine?.snapshot().focusedWindowId,
			revision: machine?.snapshot().revision,
			needsApproval: approval ? error.gate : undefined,
		} satisfies MemonToolStructured,
	};
};

/** Runs a tool body with the agent's cursor and busy state on the machine. */
export const runMemonTool = async (
	action: string,
	context: ToolExecutionContext | undefined,
	label: string,
	target: (machine: MemonMachine) => { windowId?: string | null; ref?: string },
	body: (machine: MemonMachine) => Promise<string | MemonToolOutput>,
): Promise<ToolExecutionResult> => {
	let machine: MemonMachine | undefined;
	try {
		const acquired = await acquireMemonMachine(action, context);
		machine = acquired.machine;
		if (acquired.blocked) return acquired.blocked;
		const active = machine;
		const output = await active.runAgentAction(label, target(active), () =>
			body(active),
		);
		return memonResult(active, action, output);
	} catch (error) {
		return memonFailure(machine, action, error);
	}
};
