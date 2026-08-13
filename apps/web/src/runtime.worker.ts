import { MessagePortRuntimeHost } from "@/platform/transports";

let host: MessagePortRuntimeHost | null = null;

self.addEventListener("message", (event: MessageEvent<{ type?: string }>) => {
	if (event.data?.type !== "MEMORALL_CONNECT_RUNTIME") return;
	const port = event.ports[0];
	if (!port) return;
	host?.close();
	host = new MessagePortRuntimeHost(port, {
		health: () => ({ protocol: "memorall.runtime.v1", ready: true }),
	});
});
