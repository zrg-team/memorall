import { useSyncExternalStore } from "react";
import type { SandboxRuntimePort } from "@/platform/contracts/core";
import {
	type DesktopSandboxState,
	desktopSandboxController,
} from "@/services/sandbox-container/desktop-sandbox-controller";

const empty: DesktopSandboxState = { status: null, action: null, error: null };
const subscribeEmpty = () => () => {};
const getEmpty = () => empty;

export const useDesktopSandbox = (runtime?: SandboxRuntimePort) => {
	const controller = runtime ? desktopSandboxController(runtime) : null;
	const state = useSyncExternalStore(
		controller?.subscribe ?? subscribeEmpty,
		controller?.getSnapshot ?? getEmpty,
	);
	return {
		...state,
		controller,
		ready:
			!runtime ||
			(!!state.status?.ready &&
				state.status.state === "ready" &&
				!state.action &&
				!state.error),
	};
};
