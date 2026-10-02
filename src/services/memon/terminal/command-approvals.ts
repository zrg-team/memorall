import { MemonApprovalRequiredError } from "../approval-error";
import { MEMON_APPROVAL_WAIT_MS } from "../constants";
import type { MemonFeatureConfig } from "../feature-config";
import type { MemonTerminalApproval } from "../types";

type Decision = "approve" | "deny" | "timeout" | "cancelled";

const INSTALL_PATTERN = /\b(npm|pnpm|yarn)\s+(i|install|add)\b/;
const DELETE_PATTERN = /(^|[;&|]\s*)(rm|rmdir)\s/;

const REASONS: Record<MemonTerminalApproval["gate"], string> = {
	installs: "Installing packages needs the user's approval.",
	deletes: "Deleting files needs the user's approval.",
};

export interface CommandApprovalsHost {
	askBefore(): MemonFeatureConfig["askBefore"];
	/** Puts the Terminal in front of the user. */
	showWindow(): void;
	/** Tells the user the agent waits for their answer. */
	awaitUser(): void;
	changed(): void;
}

/**
 * The agent's commands that need the user's go-ahead (installs, deletes):
 * one waits in the Terminal at a time, until the user runs or declines it.
 */
export class CommandApprovals {
	private pending: MemonTerminalApproval | null = null;
	private seq = 0;
	private answerWait: ((decision: Decision) => void) | null = null;

	constructor(private readonly host: CommandApprovalsHost) {}

	get current(): MemonTerminalApproval | null {
		return this.pending ? { ...this.pending } : null;
	}

	private gateFor(command: string): MemonTerminalApproval["gate"] | null {
		const askBefore = this.host.askBefore();
		if (askBefore.installs && INSTALL_PATTERN.test(command)) return "installs";
		if (askBefore.deletes && DELETE_PATTERN.test(command)) return "deletes";
		return null;
	}

	/**
	 * Returns once the user approves the agent's command, or at once when it
	 * needs no approval. Declined or unanswered, it throws for the agent;
	 * unanswered, the command stays in the Terminal for the user to run later.
	 */
	async require(command: string, terminalId: string): Promise<void> {
		const gate = this.gateFor(command);
		if (!gate) return;
		const reason = REASONS[gate];
		this.host.showWindow();
		this.seq += 1;
		const id = `a${this.seq}`;
		this.pending = {
			id,
			command,
			gate,
			reason,
			requestedAt: Date.now(),
			agentWaiting: true,
			terminalId,
		};
		this.host.awaitUser();
		this.host.changed();
		const decision = await new Promise<Decision>((resolve) => {
			const timer = setTimeout(() => finish("timeout"), MEMON_APPROVAL_WAIT_MS);
			const finish = (answer: Decision) => {
				clearTimeout(timer);
				this.answerWait = null;
				resolve(answer);
			};
			this.answerWait = finish;
		});
		if (decision === "approve") {
			this.pending = null;
			this.host.changed();
			return;
		}
		if (decision === "timeout" && this.pending?.id === id) {
			this.pending = { ...this.pending, agentWaiting: false };
		} else if (this.pending?.id === id) {
			this.pending = null;
		}
		this.host.changed();
		throw new MemonApprovalRequiredError(
			gate,
			decision === "deny"
				? `The user declined to run \`${command}\`. Do not run it; ask what they would like instead.`
				: decision === "cancelled"
					? "The user stopped the run before answering."
					: `${reason} The user has not answered; the command waits in the Terminal for them to run or dismiss.`,
		);
	}

	/**
	 * The user's answer. The agent's waiting call runs an approved command
	 * itself; one it gave up on comes back for the caller to run.
	 */
	answer(
		id: string,
		decision: "approve" | "deny",
	): MemonTerminalApproval | null {
		const approval = this.pending;
		if (!approval || approval.id !== id) {
			throw new Error("That command is no longer waiting for approval.");
		}
		if (this.answerWait) {
			this.answerWait(decision);
			return null;
		}
		this.pending = null;
		this.host.changed();
		return decision === "approve" ? approval : null;
	}

	/** Releases the agent's waiting call, e.g. when the user presses Stop. */
	cancel(): void {
		this.answerWait?.("cancelled");
	}
}
