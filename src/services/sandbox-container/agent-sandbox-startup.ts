import { platform } from "@/platform/current";
import { desktopSandboxController } from "./desktop-sandbox-controller";

/** Enabling or using an agent warms the native VM without waiting for a tool. */
export const startDesktopSandboxForAgent = (
	config:
		| { steps: readonly { name: string; enabled?: boolean }[] }
		| null
		| undefined,
	options: { automatic?: boolean } = {},
): void => {
	if (
		!platform.sandboxRuntime ||
		!config?.steps.some(
			(step) => step.name === "nodejs-sandbox-feature" && step.enabled === true,
		)
	)
		return;
	void desktopSandboxController(platform.sandboxRuntime).start(options);
};
