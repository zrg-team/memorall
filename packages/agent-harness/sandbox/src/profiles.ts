import type { CoreSandboxCapability } from "./contracts.js";

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

export const SANDBOX_STATEFUL_TOOLS = [...SANDBOX_WEB_APP_TOOLS, "sandbox_snapshot"] as const;
export type SandboxToolName = (typeof SANDBOX_STATEFUL_TOOLS)[number];

const REQUIREMENTS: Record<SandboxToolName, readonly CoreSandboxCapability[]> = {
  sandbox_inspect: [],
  sandbox_run: ["runtime.code", "runtime.file", "runtime.command", "runtime.repl"],
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
  const selected = profile === "execution"
    ? SANDBOX_EXECUTION_TOOLS
    : profile === "stateful"
      ? SANDBOX_STATEFUL_TOOLS
      : SANDBOX_WEB_APP_TOOLS;
  if (!supported) return selected;
  const available = new Set(supported);
  return selected.filter((name) => REQUIREMENTS[name].every((capability) => available.has(capability)));
};

export const buildSandboxInstructions = (tools: readonly SandboxToolName[]): string =>
  `A browser-compatible sandbox is available through: ${tools.join(", ")}. ` +
  "Files are synchronized by the harness. Reuse opaque process cursors and provider-returned preview URLs.";
