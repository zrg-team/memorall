import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromePortTransport } from "../bridges/chrome-port-rpc";
import type { RpcRequest, RpcResponse } from "../bridges/types";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logError: vi.fn(),
}));

type Listener = (message: unknown) => void;

interface FakePort {
	name: string;
	sent: RpcRequest[];
	connected: boolean;
	postMessage: (message: RpcRequest) => void;
	disconnect: () => void;
	onMessage: {
		addListener(l: Listener): void;
		removeListener(l: Listener): void;
	};
	onDisconnect: {
		addListener(l: () => void): void;
		removeListener(l: () => void): void;
	};
	/** Server side: reply on this port. */
	reply(response: RpcResponse): void;
	/** Server side: close this port. */
	close(): void;
}

const createFakeChrome = () => {
	const ports: FakePort[] = [];
	/** Whether a server answers new ports. */
	const server = { answering: true };

	const connect = vi.fn(({ name }: { name: string }) => {
		const messageListeners = new Set<Listener>();
		const disconnectListeners = new Set<() => void>();
		const port: FakePort = {
			name,
			sent: [],
			connected: true,
			postMessage(message) {
				if (!port.connected)
					throw new Error("Attempting to use a disconnected port");
				port.sent.push(message);
				if (server.answering && message.op === "health") {
					queueMicrotask(() =>
						port.reply({ id: message.id, ok: true, data: { status: "ok" } }),
					);
				}
			},
			disconnect() {
				port.connected = false;
			},
			onMessage: {
				addListener: (l) => messageListeners.add(l),
				removeListener: (l) => messageListeners.delete(l),
			},
			onDisconnect: {
				addListener: (l) => disconnectListeners.add(l),
				removeListener: (l) => disconnectListeners.delete(l),
			},
			reply(response) {
				if (port.connected) for (const l of [...messageListeners]) l(response);
			},
			close() {
				port.connected = false;
				for (const l of [...disconnectListeners]) l();
			},
		};
		ports.push(port);
		return port;
	});

	Object.defineProperty(globalThis, "chrome", {
		configurable: true,
		value: { runtime: { connect, lastError: undefined } },
	});
	return { ports, server, connect };
};

const request = (id: number): RpcRequest => ({
	id,
	op: "query",
	payload: { sql: "SELECT 1" },
});

describe("createChromePortTransport", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		Reflect.deleteProperty(globalThis, "chrome");
	});

	it("holds requests until the server answered the handshake", async () => {
		const { ports, server } = createFakeChrome();
		server.answering = false;
		const transport = await createChromePortTransport({ channelName: "db" });
		transport.post(request(1));
		const [handshake] = ports[0]!.sent;
		expect(ports[0]!.sent.map((m) => m.op)).toEqual(["health"]);

		ports[0]!.reply({ id: handshake!.id, ok: true, data: { status: "ok" } });
		expect(ports[0]!.sent.map((m) => m.id)).toEqual([handshake!.id, 1]);
	});

	it("keeps handshake answers away from subscribers", async () => {
		const { ports } = createFakeChrome();
		const transport = await createChromePortTransport({ channelName: "db" });
		const received: RpcResponse[] = [];
		transport.subscribe((message) => received.push(message));
		await vi.advanceTimersByTimeAsync(0);

		ports[0]!.reply({ id: 1, ok: true, data: [] });
		expect(received).toEqual([{ id: 1, ok: true, data: [] }]);
	});

	it("reconnects and asks for the offscreen document when nobody answers", async () => {
		const { ports, server } = createFakeChrome();
		server.answering = false;
		const ensureOffscreen = vi.fn(async () => {
			server.answering = true;
		});
		const transport = await createChromePortTransport({
			channelName: "db",
			ensureOffscreen,
			responseTimeoutMs: 500,
		});
		transport.post(request(7));

		await vi.advanceTimersByTimeAsync(500);
		expect(ports[0]!.connected).toBe(false);
		expect(ports[0]!.sent.map((m) => m.op)).toEqual(["health"]);

		await vi.advanceTimersByTimeAsync(200);
		expect(ensureOffscreen).toHaveBeenCalledTimes(1);
		expect(ports).toHaveLength(2);
		expect(ports[1]!.sent.map((m) => m.id)).toContain(7);
	});

	it("treats a port closed before the handshake as unanswered", async () => {
		const { ports, server } = createFakeChrome();
		server.answering = false;
		const ensureOffscreen = vi.fn(async () => undefined);
		await createChromePortTransport({ channelName: "db", ensureOffscreen });

		ports[0]!.close();
		await vi.advanceTimersByTimeAsync(150);
		expect(ensureOffscreen).toHaveBeenCalledTimes(1);
		expect(ports).toHaveLength(2);
	});

	it("drops a port whose heartbeat goes unanswered", async () => {
		const { ports, server } = createFakeChrome();
		const transport = await createChromePortTransport({
			channelName: "db",
			heartbeatIntervalMs: 1_000,
			responseTimeoutMs: 300,
		});
		await vi.advanceTimersByTimeAsync(0);

		server.answering = false;
		await vi.advanceTimersByTimeAsync(1_300);
		expect(ports[0]!.connected).toBe(false);

		server.answering = true;
		await vi.advanceTimersByTimeAsync(200);
		transport.post(request(3));
		await vi.advanceTimersByTimeAsync(0);
		expect(ports.at(-1)!.sent.map((m) => m.id)).toContain(3);
	});
});
