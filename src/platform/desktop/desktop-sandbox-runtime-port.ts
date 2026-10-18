import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "@/utils/error-message";
import type {
	SandboxRuntimePort,
	SandboxRuntimeStatus,
} from "../contracts/core";

export function encodeVmValue(value: unknown): unknown {
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		const bytes =
			value instanceof ArrayBuffer
				? new Uint8Array(value)
				: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		let binary = "";
		for (let offset = 0; offset < bytes.length; offset += 8192)
			binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
		return { $bytes: btoa(binary) };
	}
	if (Array.isArray(value)) return value.map(encodeVmValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.map(([key, item]) => [key, encodeVmValue(item)]),
		);
	return value ?? null;
}
export function decodeVmValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodeVmValue);
	if (value && typeof value === "object") {
		if (
			"$bytes" in value &&
			typeof value.$bytes === "string" &&
			Object.keys(value).length === 1
		) {
			const binary = atob(value.$bytes);
			return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
		}
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, decodeVmValue(item)]),
		);
	}
	return value;
}
export class DesktopSandboxRuntimePort implements SandboxRuntimePort {
	constructor(
		private readonly call: (
			command: string,
			args?: Record<string, unknown>,
		) => Promise<unknown> = invoke,
	) {}
	private async invoke(command: string, args?: Record<string, unknown>) {
		try {
			return await this.call(command, args);
		} catch (error) {
			if (error instanceof Error) throw error;
			const normalized = new Error(errorMessage(error), { cause: error });
			if (error && typeof error === "object" && "code" in error)
				Object.assign(normalized, { code: error.code });
			throw normalized;
		}
	}
	async request<T>(
		operation: string,
		payload?: unknown,
		timeoutMs = 120_000,
	): Promise<T> {
		return decodeVmValue(
			await this.invoke("desktop_sandbox_request", {
				operation,
				payload: encodeVmValue(payload),
				timeoutMs,
			}),
		) as T;
	}
	async stop(): Promise<void> {
		await this.invoke("desktop_sandbox_stop");
	}
	async status(): Promise<SandboxRuntimeStatus> {
		return (await this.invoke(
			"desktop_sandbox_status",
		)) as SandboxRuntimeStatus;
	}
}
