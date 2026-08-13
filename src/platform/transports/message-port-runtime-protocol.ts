export const RUNTIME_PROTOCOL = "memorall.runtime.v1" as const;

export interface RuntimeRequestMessage {
	protocol: typeof RUNTIME_PROTOCOL;
	type: "request";
	id: number;
	mode: "request" | "stream";
	method: string;
	params: unknown;
}

export interface RuntimeCancelMessage {
	protocol: typeof RUNTIME_PROTOCOL;
	type: "cancel";
	id: number;
}

export interface RuntimeResponseMessage {
	protocol: typeof RUNTIME_PROTOCOL;
	type: "response";
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export interface RuntimeStreamItemMessage {
	protocol: typeof RUNTIME_PROTOCOL;
	type: "stream-item";
	id: number;
	sequence: number;
	value: unknown;
}

export interface RuntimeStreamEndMessage {
	protocol: typeof RUNTIME_PROTOCOL;
	type: "stream-end";
	id: number;
	ok: boolean;
	error?: string;
}

export type RuntimeClientMessage = RuntimeRequestMessage | RuntimeCancelMessage;
export type RuntimeHostMessage =
	| RuntimeResponseMessage
	| RuntimeStreamItemMessage
	| RuntimeStreamEndMessage;

export function isRuntimeClientMessage(
	value: unknown,
): value is RuntimeClientMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<RuntimeClientMessage>;
	return (
		message.protocol === RUNTIME_PROTOCOL &&
		typeof message.id === "number" &&
		(message.type === "request" || message.type === "cancel")
	);
}

export function isRuntimeHostMessage(
	value: unknown,
): value is RuntimeHostMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<RuntimeHostMessage>;
	return (
		message.protocol === RUNTIME_PROTOCOL &&
		typeof message.id === "number" &&
		(message.type === "response" ||
			message.type === "stream-item" ||
			message.type === "stream-end")
	);
}
