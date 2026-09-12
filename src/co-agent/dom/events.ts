import type { CoAgentPoint, CoAgentRect } from "@/co-agent/protocol";
import { CO_AGENT_STATUS_EVENT } from "@/co-agent/constants";

export const emitCursorEvent = (detail: {
	selector?: string;
	index?: number;
	point?: CoAgentPoint;
	rect?: CoAgentRect;
	scrollIntoView?: boolean;
	message?: string;
	mode?: "moveTo" | "jumpTo";
}): void => {
	window.dispatchEvent(
		new CustomEvent("memorall:agent-cursor", {
			detail,
		}),
	);
};

export const emitCoAgentStatus = (message: string): void => {
	window.dispatchEvent(
		new CustomEvent(CO_AGENT_STATUS_EVENT, { detail: { message } }),
	);
};
