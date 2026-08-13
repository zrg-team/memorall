import { MessagePortRuntimeTransport } from "@/platform/transports";

export interface WebRuntimeConnection {
	transport: MessagePortRuntimeTransport;
	host: "shared-worker" | "dedicated-worker";
	close(): Promise<void>;
}

export function connectWebRuntime(): WebRuntimeConnection {
	if (typeof SharedWorker !== "undefined") {
		const worker = new SharedWorker(
			new URL("./runtime.shared-worker.ts", import.meta.url),
			{ type: "module", name: "memorall-runtime" },
		);
		const transport = new MessagePortRuntimeTransport(worker.port);
		return {
			transport,
			host: "shared-worker",
			close: () => transport.close(),
		};
	}

	const worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), {
		type: "module",
		name: "memorall-runtime-fallback",
	});
	const channel = new MessageChannel();
	worker.postMessage({ type: "MEMORALL_CONNECT_RUNTIME" }, [channel.port2]);
	const transport = new MessagePortRuntimeTransport(channel.port1);
	return {
		transport,
		host: "dedicated-worker",
		close: async () => {
			await transport.close();
			worker.terminate();
		},
	};
}

export async function withDatasetWriterLock<T>(
	datasetId: string,
	action: (signal: AbortSignal) => Promise<T>,
	signal: AbortSignal = new AbortController().signal,
): Promise<T> {
	if (!("locks" in navigator)) {
		throw new Error(
			"This browser cannot safely coordinate the Memorall database across tabs.",
		);
	}
	return navigator.locks.request(
		`memorall:dataset:${datasetId}:writer`,
		{ mode: "exclusive", signal },
		() => action(signal),
	);
}
