export {
	formatCoAgentTracePrompt,
	getCoAgentTrace,
} from "@/embedded/utils/co-agent/trace";
export {
	CO_AGENT_CAPTURE_EVENT,
	CO_AGENT_STATUS_EVENT,
} from "./constants";
export {
	createGetTraceRequest,
	handleCoAgentContentCommand,
} from "./content-command-handler";
export { emitCoAgentStatus } from "./events";
export { createCoAgentOverlay, destroyCoAgentOverlay } from "./overlay";
