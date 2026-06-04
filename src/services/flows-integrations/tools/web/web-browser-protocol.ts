export type WebBrowserMode = "iframe" | "tab" | "window";
export type BrowserBackedWebMode = Exclude<WebBrowserMode, "iframe">;
export type WebDomActionName =
	| "read"
	| "click"
	| "input"
	| "focus"
	| "scrollBottom"
	| "scrollTop";
export type WebWaitSelectorState = "present" | "absent";

export interface WebElementRecord {
	index?: number;
	label: string | null;
	text: string;
	value: string | null;
}

export interface WebDomElementInfo {
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
}

export interface WebSnapshotPayload {
	url: string;
	title: string;
	html: string;
	text: string;
	domAccessible: boolean;
}

export interface WebBrowserSurface {
	mode: BrowserBackedWebMode;
	tabId: number;
	windowId?: number;
}

export const WEB_BROWSER_COMMAND_SOURCE =
	"memorall:web-browser-command" as const;
export const WEB_CONTENT_COMMAND_SOURCE =
	"memorall:web-content-command" as const;
export const WEB_BROWSER_SURFACE_STORAGE_KEY =
	"memorall.active-web-browser-surface.v2";

export type WebContentCommandRequest =
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:snapshot";
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:dom-query";
			selector: string;
			maxResults: number;
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:dom-action";
			action: WebDomActionName;
			selector: string;
			index?: number;
			value?: string;
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:wait-selector";
			selector: string;
			state: WebWaitSelectorState;
			timeoutMs: number;
			intervalMs: number;
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:fetch-image";
			url: string;
	  };

export type WebContentCommandResponse =
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:snapshot-result";
			success: true;
			snapshot: WebSnapshotPayload;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:dom-query-result";
			success: true;
			snapshot: WebSnapshotPayload;
			elements: WebDomElementInfo[];
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:dom-action-result";
			success: true;
			snapshot: WebSnapshotPayload;
			result: WebElementRecord;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:wait-selector-result";
			success: true;
			snapshot: WebSnapshotPayload;
			matched: boolean;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type: "web-tool:fetch-image-result";
			success: true;
			base64: string;
			mimeType: string;
	  }
	| {
			source: typeof WEB_CONTENT_COMMAND_SOURCE;
			type:
				| "web-tool:snapshot-result"
				| "web-tool:dom-query-result"
				| "web-tool:dom-action-result"
				| "web-tool:wait-selector-result"
				| "web-tool:fetch-image-result";
			success: false;
			error: string;
	  };

export type WebBrowserCommandRequest =
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "open";
			sessionId: string;
			url: string;
			mode: BrowserBackedWebMode;
			timeoutMs: number;
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "snapshot";
			sessionId: string;
			tabId: number;
			timeoutMs: number;
			maxHtmlChars: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "dom-query";
			sessionId: string;
			tabId: number;
			timeoutMs: number;
			maxHtmlChars: number;
			selector: string;
			maxResults: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "dom-action";
			sessionId: string;
			tabId: number;
			timeoutMs: number;
			maxHtmlChars: number;
			action: WebDomActionName;
			selector: string;
			index?: number;
			value?: string;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "wait-selector";
			sessionId: string;
			tabId: number;
			timeoutMs: number;
			intervalMs: number;
			maxHtmlChars: number;
			selector: string;
			state: WebWaitSelectorState;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "close";
			sessionId: string;
			tabId?: number;
			windowId?: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "screenshot";
			sessionId: string;
			tabId: number;
			windowId?: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "fetch-image";
			sessionId: string;
			url: string;
			tabId: number;
	  };

export type WebBrowserCommandResponse =
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "open";
			success: true;
			sessionId: string;
			surface: WebBrowserSurface;
			snapshot: WebSnapshotPayload;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "snapshot";
			success: true;
			sessionId: string;
			snapshot: WebSnapshotPayload;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "dom-query";
			success: true;
			sessionId: string;
			snapshot: WebSnapshotPayload;
			elements: WebDomElementInfo[];
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "dom-action";
			success: true;
			sessionId: string;
			snapshot: WebSnapshotPayload;
			result: WebElementRecord;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "wait-selector";
			success: true;
			sessionId: string;
			snapshot: WebSnapshotPayload;
			matched: boolean;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "close";
			success: true;
			sessionId: string;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "screenshot";
			success: true;
			sessionId: string;
			dataUrl: string;
			width: number;
			height: number;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command: "fetch-image";
			success: true;
			sessionId: string;
			base64: string;
			mimeType: string;
	  }
	| {
			source: typeof WEB_BROWSER_COMMAND_SOURCE;
			command:
				| "open"
				| "snapshot"
				| "dom-query"
				| "dom-action"
				| "wait-selector"
				| "close"
				| "screenshot"
				| "fetch-image";
			success: false;
			sessionId: string;
			error: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const isWebContentCommandRequest = (
	value: unknown,
): value is WebContentCommandRequest => {
	if (!isRecord(value) || value.source !== WEB_CONTENT_COMMAND_SOURCE) {
		return false;
	}

	switch (value.type) {
		case "web-tool:snapshot":
			return typeof value.maxHtmlChars === "number";
		case "web-tool:dom-query":
			return (
				typeof value.selector === "string" &&
				typeof value.maxResults === "number" &&
				typeof value.maxHtmlChars === "number"
			);
		case "web-tool:dom-action":
			return (
				typeof value.action === "string" &&
				typeof value.selector === "string" &&
				typeof value.maxHtmlChars === "number"
			);
		case "web-tool:wait-selector":
			return (
				typeof value.selector === "string" &&
				typeof value.state === "string" &&
				typeof value.timeoutMs === "number" &&
				typeof value.intervalMs === "number" &&
				typeof value.maxHtmlChars === "number"
			);
		case "web-tool:fetch-image":
			return typeof value.url === "string";
		default:
			return false;
	}
};

export const isWebContentCommandResponse = (
	value: unknown,
): value is WebContentCommandResponse => {
	if (
		!isRecord(value) ||
		value.source !== WEB_CONTENT_COMMAND_SOURCE ||
		typeof value.success !== "boolean" ||
		typeof value.type !== "string"
	) {
		return false;
	}

	if (!value.success) {
		return typeof value.error === "string";
	}

	switch (value.type) {
		case "web-tool:snapshot-result":
			return isRecord(value.snapshot);
		case "web-tool:dom-query-result":
			return Array.isArray(value.elements) && isRecord(value.snapshot);
		case "web-tool:dom-action-result":
			return isRecord(value.result) && isRecord(value.snapshot);
		case "web-tool:wait-selector-result":
			return typeof value.matched === "boolean" && isRecord(value.snapshot);
		case "web-tool:fetch-image-result":
			return (
				typeof value.base64 === "string" && typeof value.mimeType === "string"
			);
		default:
			return false;
	}
};

export const isWebBrowserCommandRequest = (
	value: unknown,
): value is WebBrowserCommandRequest => {
	if (!isRecord(value) || value.source !== WEB_BROWSER_COMMAND_SOURCE) {
		return false;
	}

	switch (value.command) {
		case "open":
			return (
				typeof value.sessionId === "string" &&
				typeof value.url === "string" &&
				typeof value.mode === "string" &&
				typeof value.timeoutMs === "number" &&
				typeof value.maxHtmlChars === "number"
			);
		case "snapshot":
			return (
				typeof value.sessionId === "string" &&
				typeof value.tabId === "number" &&
				typeof value.timeoutMs === "number" &&
				typeof value.maxHtmlChars === "number"
			);
		case "dom-query":
			return (
				typeof value.sessionId === "string" &&
				typeof value.tabId === "number" &&
				typeof value.timeoutMs === "number" &&
				typeof value.maxHtmlChars === "number" &&
				typeof value.selector === "string" &&
				typeof value.maxResults === "number"
			);
		case "dom-action":
			return (
				typeof value.sessionId === "string" &&
				typeof value.tabId === "number" &&
				typeof value.timeoutMs === "number" &&
				typeof value.maxHtmlChars === "number" &&
				typeof value.action === "string" &&
				typeof value.selector === "string"
			);
		case "wait-selector":
			return (
				typeof value.sessionId === "string" &&
				typeof value.tabId === "number" &&
				typeof value.timeoutMs === "number" &&
				typeof value.intervalMs === "number" &&
				typeof value.maxHtmlChars === "number" &&
				typeof value.selector === "string" &&
				typeof value.state === "string"
			);
		case "close":
			return typeof value.sessionId === "string";
		case "screenshot":
			return (
				typeof value.sessionId === "string" && typeof value.tabId === "number"
			);
		case "fetch-image":
			return (
				typeof value.sessionId === "string" &&
				typeof value.url === "string" &&
				typeof value.tabId === "number"
			);
		default:
			return false;
	}
};

export const isWebBrowserCommandResponse = (
	value: unknown,
): value is WebBrowserCommandResponse => {
	if (
		!isRecord(value) ||
		value.source !== WEB_BROWSER_COMMAND_SOURCE ||
		typeof value.success !== "boolean" ||
		typeof value.command !== "string" ||
		typeof value.sessionId !== "string"
	) {
		return false;
	}

	if (!value.success) {
		return typeof value.error === "string";
	}

	switch (value.command) {
		case "open":
			return isRecord(value.surface) && isRecord(value.snapshot);
		case "snapshot":
			return isRecord(value.snapshot);
		case "dom-query":
			return Array.isArray(value.elements) && isRecord(value.snapshot);
		case "dom-action":
			return isRecord(value.result) && isRecord(value.snapshot);
		case "wait-selector":
			return typeof value.matched === "boolean" && isRecord(value.snapshot);
		case "close":
			return true;
		case "screenshot":
			return (
				typeof value.dataUrl === "string" &&
				typeof value.width === "number" &&
				typeof value.height === "number"
			);
		case "fetch-image":
			return (
				typeof value.base64 === "string" && typeof value.mimeType === "string"
			);
		default:
			return false;
	}
};
