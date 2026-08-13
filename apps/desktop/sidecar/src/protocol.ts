export const SIDECAR_PROTOCOL_VERSION = 1 as const;

export const SIDECAR_METHODS = [
	"health",
	"shutdown",
	"cancel",
	"workspace.read",
	"workspace.write",
	"executor.start",
	"executor.stop",
	"package.install",
	"mcp.stdio.connect",
	"chromium.install",
	"browser.open",
	"browser.dom",
] as const;

export type SidecarMethod = (typeof SIDECAR_METHODS)[number];

export interface SidecarRequest {
	protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
	id: string;
	method: SidecarMethod;
	params: unknown;
}

export interface SidecarResponse {
	protocolVersion: typeof SIDECAR_PROTOCOL_VERSION;
	id: string;
	ok: boolean;
	result?: unknown;
	error?: { code: string; message: string };
}

const methodSet = new Set<string>(SIDECAR_METHODS);

export function parseSidecarRequest(value: unknown): SidecarRequest {
	if (!value || typeof value !== "object") throw new Error("Request must be an object");
	const request = value as Record<string, unknown>;
	if (request.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
		throw new Error(`Unsupported sidecar protocol version: ${String(request.protocolVersion)}`);
	}
	if (typeof request.id !== "string" || request.id.length === 0) {
		throw new Error("Request id must be a non-empty string");
	}
	if (typeof request.method !== "string" || !methodSet.has(request.method)) {
		throw new Error(`Sidecar method is not allowed: ${String(request.method)}`);
	}
	return request as unknown as SidecarRequest;
}
