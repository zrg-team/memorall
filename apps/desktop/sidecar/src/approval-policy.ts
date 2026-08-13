export type ExecutorApprovalMode = "every-operation" | "agent-session";

export interface ExecutorIntent {
	command: string;
	args: string[];
	cwd: string;
	workspaceRoot: string;
	network: boolean;
}

export interface ExecutorLimits {
	maxDurationMs: number;
	maxOutputBytes: number;
	maxProcesses: number;
}

export interface ExecutorApproval {
	enabled: boolean;
	mode: ExecutorApprovalMode;
	agentSessionId?: string;
	approvedWorkspaceRoots: string[];
	limits: ExecutorLimits;
}

export function assertExecutorApproved(
	intent: ExecutorIntent,
	approval: ExecutorApproval,
	currentAgentSessionId?: string,
): void {
	if (!approval.enabled) throw new Error("Local executor is disabled");
	if (
		approval.mode === "agent-session" &&
		(!currentAgentSessionId || approval.agentSessionId !== currentAgentSessionId)
	) {
		throw new Error("Local executor approval does not cover this agent session");
	}

	const cwd = normalize(intent.cwd);
	const allowed = approval.approvedWorkspaceRoots.some((root) => {
		const normalizedRoot = normalize(root);
		return cwd === normalizedRoot || cwd.startsWith(`${normalizedRoot}/`);
	});
	if (!allowed) throw new Error("Working directory is outside approved workspace roots");
	if (approval.limits.maxDurationMs <= 0 || approval.limits.maxOutputBytes <= 0) {
		throw new Error("Executor limits must be positive");
	}
}

function normalize(value: string): string {
	return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

export function createSanitizedEnvironment(
	source: Readonly<Record<string, string | undefined>>,
	allowList: readonly string[],
): Record<string, string> {
	const sanitized: Record<string, string> = {};
	for (const key of allowList) {
		const value = source[key];
		if (value !== undefined) sanitized[key] = value;
	}
	return sanitized;
}
