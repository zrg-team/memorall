import { MessagePortRuntimeHost } from "@/platform/transports";

const hosts = new Set<MessagePortRuntimeHost>();

const workerScope = globalThis as typeof globalThis & {
	onconnect: ((event: MessageEvent) => void) | null;
};

workerScope.onconnect = (event: MessageEvent) => {
	const port = event.ports[0];
	if (!port) return;
	const host = new MessagePortRuntimeHost(port, {
		health: () => ({ protocol: "memorall.runtime.v1", ready: true }),
	});
	hosts.add(host);
};
