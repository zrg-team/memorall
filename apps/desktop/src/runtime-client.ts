import { MessagePortRuntimeTransport } from "@/platform/transports";

export function connectDesktopWorkerRuntime(): {
	transport: MessagePortRuntimeTransport;
	close(): Promise<void>;
} {
	const worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), {
		type: "module",
		name: "memorall-desktop-runtime",
	});
	const channel = new MessageChannel();
	worker.postMessage({ type: "MEMORALL_CONNECT_RUNTIME" }, [channel.port2]);
	const transport = new MessagePortRuntimeTransport(channel.port1);
	return {
		transport,
		close: async () => {
			await transport.close();
			worker.terminate();
		},
	};
}
