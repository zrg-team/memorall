export const CO_AGENT_BROWSER_COMMAND_SOURCE =
	"memorall:co-agent-browser-command" as const;
export const CO_AGENT_CONTENT_COMMAND_SOURCE =
	"memorall:co-agent-content-command" as const;

export type CoAgentCursorMode = "moveTo" | "jumpTo";

export interface CoAgentPoint {
	x: number;
	y: number;
}

export interface CoAgentRect extends CoAgentPoint {
	width: number;
	height: number;
}

export interface CoAgentViewport {
	width: number;
	height: number;
	scrollX: number;
	scrollY: number;
	scrollWidth: number;
	scrollHeight: number;
}

export interface CoAgentImageInfo {
	src: string;
	alt: string | null;
	title: string | null;
	width: number;
	height: number;
}

export interface CoAgentElementInfo {
	index: number;
	tagName: string;
	id: string | null;
	name: string | null;
	type: string | null;
	placeholder: string | null;
	ariaLabel: string | null;
	title: string | null;
	role: string | null;
	text: string;
	value: string | null;
	href: string | null;
	disabled: boolean;
	visible: boolean;
	acceptsTextInput: boolean;
	stableSelector: string;
	rect: CoAgentRect;
	images?: CoAgentImageInfo[];
}

export interface CoAgentPageSnapshot {
	url: string;
	title: string;
	viewport: CoAgentViewport;
	visibleText?: string;
	text?: string;
	textRange?: {
		from: number;
		to: number;
		total: number;
		truncated: boolean;
		maxChars: number;
	};
	domSummary?: CoAgentElementInfo[];
}

export interface CoAgentTraceStep {
	id: string;
	timestamp: string;
	url: string;
	title: string;
	command: CoAgentContentCommandRequest["type"];
	args: Record<string, unknown>;
	before: CoAgentViewport;
	after: CoAgentViewport;
	resultSummary: string;
	selector?: string;
	stableSelector?: string;
	rect?: CoAgentRect;
	blocked?: boolean;
}

export type CoAgentContentCommandRequest =
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:observe";
			scope?: "metadata" | "selector" | "selection" | "viewport" | "page";
			selector?: string;
			index?: number;
			maxTextChars?: number;
			maxVisibleTextChars?: number;
			textStart?: number;
			maxDomElements?: number;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:query";
			selector: string;
			maxResults?: number;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:move";
			selector?: string;
			index?: number;
			point?: CoAgentPoint;
			rect?: CoAgentRect;
			scrollIntoView?: boolean;
			message?: string;
			mode?: CoAgentCursorMode;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:scroll";
			selector?: string;
			index?: number;
			deltaX?: number;
			deltaY?: number;
			top?: number;
			left?: number;
			behavior?: ScrollBehavior;
			message?: string;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:click";
			selector: string;
			index?: number;
			message?: string;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:input";
			selector: string;
			index?: number;
			value: string;
			message?: string;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: "co-agent:get-trace";
	  };

export type CoAgentContentCommandResponse =
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: `${CoAgentContentCommandRequest["type"]}-result`;
			success: true;
			snapshot?: CoAgentPageSnapshot;
			elements?: CoAgentElementInfo[];
			element?: CoAgentElementInfo;
			trace?: CoAgentTraceStep[];
			blocked?: boolean;
			requiresUserAction?: boolean;
			note?: string;
	  }
	| {
			source: typeof CO_AGENT_CONTENT_COMMAND_SOURCE;
			type: `${CoAgentContentCommandRequest["type"]}-result`;
			success: false;
			error: string;
	  };

export interface CoAgentActiveSession {
	tabId: number;
	windowId?: number;
	url?: string;
	title?: string;
	enabledAt: number;
}

export type CoAgentBrowserCommandRequest =
	| {
			source: typeof CO_AGENT_BROWSER_COMMAND_SOURCE;
			command: "content-command";
			request: CoAgentContentCommandRequest;
			timeoutMs?: number;
	  }
	| {
			source: typeof CO_AGENT_BROWSER_COMMAND_SOURCE;
			command: "get-active";
	  };

export type CoAgentBrowserCommandResponse =
	| {
			source: typeof CO_AGENT_BROWSER_COMMAND_SOURCE;
			command: CoAgentBrowserCommandRequest["command"];
			success: true;
			session?: CoAgentActiveSession;
			contentResponse?: CoAgentContentCommandResponse;
	  }
	| {
			source: typeof CO_AGENT_BROWSER_COMMAND_SOURCE;
			command: CoAgentBrowserCommandRequest["command"];
			success: false;
			error: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isPoint = (value: unknown): value is CoAgentPoint =>
	isRecord(value) && typeof value.x === "number" && typeof value.y === "number";

const isRect = (value: unknown): value is CoAgentRect =>
	isRecord(value) &&
	isPoint(value) &&
	typeof value.width === "number" &&
	typeof value.height === "number";

export const isCoAgentContentCommandRequest = (
	value: unknown,
): value is CoAgentContentCommandRequest => {
	if (!isRecord(value) || value.source !== CO_AGENT_CONTENT_COMMAND_SOURCE) {
		return false;
	}

	switch (value.type) {
		case "co-agent:observe":
			return (
				(value.scope === undefined ||
					value.scope === "metadata" ||
					value.scope === "selector" ||
					value.scope === "selection" ||
					value.scope === "viewport" ||
					value.scope === "page") &&
				(value.selector === undefined || typeof value.selector === "string") &&
				(value.textStart === undefined ||
					typeof value.textStart === "number") &&
				(value.scope !== "selector" || typeof value.selector === "string")
			);
		case "co-agent:query":
			return typeof value.selector === "string";
		case "co-agent:move":
			return (
				(typeof value.selector === "string" ||
					isPoint(value.point) ||
					isRect(value.rect)) &&
				(value.mode === undefined ||
					value.mode === "moveTo" ||
					value.mode === "jumpTo")
			);
		case "co-agent:scroll":
			return value.selector === undefined || typeof value.selector === "string";
		case "co-agent:click":
			return typeof value.selector === "string";
		case "co-agent:input":
			return (
				typeof value.selector === "string" && typeof value.value === "string"
			);
		case "co-agent:get-trace":
			return true;
		default:
			return false;
	}
};

export const isCoAgentContentCommandResponse = (
	value: unknown,
): value is CoAgentContentCommandResponse => {
	if (
		!isRecord(value) ||
		value.source !== CO_AGENT_CONTENT_COMMAND_SOURCE ||
		typeof value.success !== "boolean" ||
		typeof value.type !== "string"
	) {
		return false;
	}

	return value.success || typeof value.error === "string";
};

export const isCoAgentBrowserCommandRequest = (
	value: unknown,
): value is CoAgentBrowserCommandRequest => {
	if (!isRecord(value) || value.source !== CO_AGENT_BROWSER_COMMAND_SOURCE) {
		return false;
	}

	if (value.command === "get-active") {
		return true;
	}

	return (
		value.command === "content-command" &&
		isCoAgentContentCommandRequest(value.request)
	);
};

export const isCoAgentBrowserCommandResponse = (
	value: unknown,
): value is CoAgentBrowserCommandResponse => {
	if (
		!isRecord(value) ||
		value.source !== CO_AGENT_BROWSER_COMMAND_SOURCE ||
		typeof value.success !== "boolean" ||
		typeof value.command !== "string"
	) {
		return false;
	}

	return value.success || typeof value.error === "string";
};
