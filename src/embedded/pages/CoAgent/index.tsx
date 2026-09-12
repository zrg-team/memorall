export {
	formatCoAgentTracePrompt,
	getCoAgentTrace,
} from "@/co-agent/dom/trace";
export {
	CO_AGENT_CAPTURE_EVENT,
	CO_AGENT_STATUS_EVENT,
} from "@/co-agent/constants";
export {
	createGetTraceRequest,
	handleCoAgentContentCommand,
} from "./content-command-handler";
export { emitCoAgentStatus } from "@/co-agent/dom/events";
export { createCoAgentOverlay, destroyCoAgentOverlay } from "./overlay";
