import type {
	RuntimeDiagnosticsPort,
	RuntimeDiagnosticsSnapshot,
	RuntimeServiceName,
} from "../contracts/core";

const unavailableSnapshot = (): RuntimeDiagnosticsSnapshot => ({
	alive: false,
	statuses: {
		webllm: { registered: false, ready: false },
		wllama: { registered: false, ready: false },
		transformer: { registered: false, ready: false },
	},
});

export class UnavailableRuntimeDiagnostics implements RuntimeDiagnosticsPort {
	async status(): Promise<RuntimeDiagnosticsSnapshot> {
		return unavailableSnapshot();
	}

	async reset(_service: RuntimeServiceName): Promise<void> {
		throw new Error("Offscreen runtime diagnostics are unavailable.");
	}
}
