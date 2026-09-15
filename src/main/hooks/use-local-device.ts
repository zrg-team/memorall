import { useEffect, useState } from "react";
import type { LocalDevice } from "@/main/modules/llm/utils/model-size";
import { detectWebGPUAdapter } from "@/utils/webgpu";

let probe: Promise<LocalDevice> | null = null;
let resolved: LocalDevice | null = null;

/**
 * The device local runners will pick in this browser: WebGPU when an adapter
 * is available, WASM otherwise. Probed once per page. `null` while probing.
 */
export function useLocalDevice(): LocalDevice | null {
	const [device, setDevice] = useState<LocalDevice | null>(resolved);

	useEffect(() => {
		if (resolved) return;
		let cancelled = false;
		probe ??= detectWebGPUAdapter().then((available) => {
			resolved = available ? "webgpu" : "wasm";
			return resolved;
		});
		void probe.then((value) => {
			if (!cancelled) setDevice(value);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return device;
}
