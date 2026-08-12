import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
}));

type Listener<T extends (...args: any[]) => void> = T;

const createEvent = <T extends (...args: any[]) => void>() => {
	const listeners = new Set<Listener<T>>();
	return {
		addListener: vi.fn((listener: Listener<T>) => listeners.add(listener)),
		removeListener: vi.fn((listener: Listener<T>) =>
			listeners.delete(listener),
		),
		emit: (...args: Parameters<T>) => {
			for (const listener of [...listeners]) listener(...args);
		},
	};
};

const createPort = (name: string, sender?: chrome.runtime.MessageSender) => {
	const onMessage = createEvent<(message: unknown) => void>();
	const onDisconnect = createEvent<() => void>();
	return {
		name,
		sender,
		onMessage,
		onDisconnect,
		postMessage: vi.fn(),
		disconnect: vi.fn(),
	} as unknown as chrome.runtime.Port & {
		onMessage: typeof onMessage;
		onDisconnect: typeof onDisconnect;
		postMessage: ReturnType<typeof vi.fn>;
	};
};

describe("PortBridge", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
		Reflect.deleteProperty(globalThis, "chrome");
	});

	it("replays unanswered RPC requests after Edge reconnects the offscreen port", async () => {
		const runtimeOnConnect = createEvent<(port: chrome.runtime.Port) => void>();
		const firstOffscreen = createPort("postgres-rpc");
		const secondOffscreen = createPort("postgres-rpc");
		const thirdOffscreen = createPort("postgres-rpc");
		const connect = vi
			.fn()
			.mockReturnValueOnce(firstOffscreen)
			.mockReturnValueOnce(secondOffscreen)
			.mockReturnValueOnce(thirdOffscreen);

		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			value: {
				runtime: {
					onConnect: runtimeOnConnect,
					connect,
					lastError: undefined,
				},
			},
		});

		const { PortBridge } = await import("../port-bridge");
		const bridge = new PortBridge();
		bridge.initialize({ proxyOptions: { channelName: "postgres-rpc" } });

		const popup = createPort("postgres-rpc", {
			id: "extension-id",
			url: "chrome-extension://extension-id/options/index.html",
		} as chrome.runtime.MessageSender);
		runtimeOnConnect.emit(popup);

		const request = { id: 42, op: "health", payload: undefined };
		popup.onMessage.emit(request);
		expect(firstOffscreen.postMessage).toHaveBeenCalledWith(request);

		// Edge disconnects while the offscreen document is still registering its
		// RPC listener. The replacement port must receive the unanswered request.
		firstOffscreen.onDisconnect.emit();
		await vi.advanceTimersByTimeAsync(200);
		expect(secondOffscreen.postMessage).toHaveBeenCalledWith(request);

		const response = { id: 42, ok: true, data: { status: "ok" } };
		secondOffscreen.onMessage.emit(response);
		expect(popup.postMessage).toHaveBeenCalledWith(response);

		// Once answered, the request must not be replayed on a later reconnect.
		secondOffscreen.onDisconnect.emit();
		await vi.advanceTimersByTimeAsync(400);
		expect(thirdOffscreen.postMessage).not.toHaveBeenCalled();
	});
});
