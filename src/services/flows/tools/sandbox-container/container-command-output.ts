import type {
	SandboxCommandInfo,
	SandboxCommandResult,
} from "../../interfaces/sandbox";

const formatTimestamp = (value: number): string =>
	new Date(value).toISOString();

const appendStreamSection = (
	lines: string[],
	label: "stdout" | "stderr",
	value: string,
): void => {
	const text = value.trimEnd();
	if (!text) {
		return;
	}

	lines.push(`${label}:`);
	lines.push(text);
};

export const formatCommandResult = (result: SandboxCommandResult): string => {
	const header = [
		`id=${result.commandId}`,
		`status=${result.status}`,
		`completed=${result.completed}`,
		`offset=${result.nextOffset}`,
	];

	if (typeof result.exitCode === "number") {
		header.push(`exit=${result.exitCode}`);
	}

	const lines = [
		header.join(" "),
		`command=${result.command}`,
		`cwd=${result.cwd}`,
		`started=${formatTimestamp(result.startedAt)}`,
		`updated=${formatTimestamp(result.updatedAt)}`,
	];

	appendStreamSection(lines, "stdout", result.stdout);
	appendStreamSection(lines, "stderr", result.stderr);
	return lines.join("\n");
};

export const formatCommandList = (commands: SandboxCommandInfo[]): string => {
	if (commands.length === 0) {
		return "No running commands.";
	}

	return commands
		.map((command) => {
			const lines = [
				`id=${command.commandId} status=${command.status} offset=${command.nextOffset}`,
				`cwd=${command.cwd}`,
				`updated=${formatTimestamp(command.updatedAt)}`,
				`command=${command.command}`,
			];

			const outputTail = command.outputTail.trimEnd();
			if (outputTail) {
				lines.push("tail:");
				lines.push(outputTail);
			}

			return lines.join("\n");
		})
		.join("\n\n");
};

export const formatCommandInputResult = (result: {
	commandId: string;
	sent: true;
}): string => `id=${result.commandId} sent=true`;

export const formatCommandStopResult = (result: {
	commandId: string;
	stopped: true;
}): string => `id=${result.commandId} stopped=true`;
