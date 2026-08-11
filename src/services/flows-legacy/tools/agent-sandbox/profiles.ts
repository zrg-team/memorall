import type { CoreSandboxCapability } from "@/services/flows-legacy/interfaces/services/agent-sandbox";

export type SandboxToolProfile = "execution" | "web_app" | "stateful";

export const SANDBOX_EXECUTION_TOOLS = [
	"sandbox_inspect",
	"sandbox_run",
	"sandbox_process",
	"sandbox_packages",
] as const;

export const SANDBOX_WEB_APP_TOOLS = [
	...SANDBOX_EXECUTION_TOOLS,
	"sandbox_preview",
	"sandbox_network",
] as const;

export const SANDBOX_STATEFUL_TOOLS = [
	...SANDBOX_WEB_APP_TOOLS,
	"sandbox_snapshot",
] as const;

export type SandboxToolName = (typeof SANDBOX_STATEFUL_TOOLS)[number];

const REQUIREMENTS: Record<SandboxToolName, readonly CoreSandboxCapability[]> =
	{
		sandbox_inspect: [],
		sandbox_run: [
			"runtime.code",
			"runtime.file",
			"runtime.command",
			"runtime.repl",
		],
		sandbox_process: ["process.background", "process.stdin"],
		sandbox_packages: ["packages.install", "packages.manifest"],
		sandbox_preview: ["preview.start", "preview.request", "preview.render"],
		sandbox_network: ["network.fetch"],
		sandbox_snapshot: ["snapshot.capture", "snapshot.restore"],
	};

export const getSandboxToolsForProfile = (
	profile: SandboxToolProfile,
	supported?: readonly string[],
): readonly SandboxToolName[] => {
	const tools =
		profile === "execution"
			? SANDBOX_EXECUTION_TOOLS
			: profile === "stateful"
				? SANDBOX_STATEFUL_TOOLS
				: SANDBOX_WEB_APP_TOOLS;
	if (!supported) return tools;
	const available = new Set(supported);
	return tools.filter((tool) =>
		REQUIREMENTS[tool].every((capability) => available.has(capability)),
	);
};
