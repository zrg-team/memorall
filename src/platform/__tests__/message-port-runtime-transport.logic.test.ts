import { afterEach, describe, expect, it } from "vitest";
import { MessagePortRuntimeHost } from "../transports/message-port-runtime-host";
import { MessagePortRuntimeTransport } from "../transports/message-port-runtime-transport";

interface Pair {
	client: MessagePortRuntimeTransport;
	host: MessagePortRuntimeHost;
}

const pairs: Pair[] = [];

function createPair(
	handlers: ConstructorParameters<typeof MessagePortRuntimeHost>[1],
	requestTimeoutMs = 1_000,
): Pair {
	const channel = new MessageChannel();
	const pair = {
		client: new MessagePortRuntimeTransport(channel.port1, {
			requestTimeoutMs,
		}),
		host: new MessagePortRuntimeHost(channel.port2, handlers),
	};
	pairs.push(pair);
	return pair;
}

afterEach(async () => {
	for (const pair of pairs.splice(0)) {
		await pair.client.close();
		pair.host.close();
	}
});

describe("MessagePort RuntimeTransport contract", () => {
	it("round-trips requests and propagates handler failures", async () => {
		const { client } = createPair({
			add: (params) => {
				const { a, b } = params as { a: number; b: number };
				return a + b;
			},
			fail: () => {
				throw new Error("expected failure");
			},
		});

		await expect(client.request<number>("add", { a: 2, b: 3 })).resolves.toBe(
			5,
		);
		await expect(client.request("fail", null)).rejects.toThrow(
			"expected failure",
		);
		await expect(client.request("missing", null)).rejects.toThrow(
			"Unknown runtime method",
		);
	});

	it("streams values in order", async () => {
		const { client } = createPair({
			sequence: async function* () {
				yield "first";
				yield "second";
				yield "third";
			},
		});

		const values: string[] = [];
		for await (const value of client.stream<string>("sequence", null)) {
			values.push(value);
		}
		expect(values).toEqual(["first", "second", "third"]);
	});

	it("cancels an in-flight request", async () => {
		let hostAborted = false;
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const { client } = createPair({
			wait: (_params, { signal }) =>
				new Promise((_resolve, reject) => {
					markStarted();
					signal.addEventListener("abort", () => {
						hostAborted = true;
						reject(new Error("host aborted"));
					});
				}),
		});
		const controller = new AbortController();
		const request = client.request("wait", null, controller.signal);
		await started;
		controller.abort();
		await expect(request).rejects.toMatchObject({ name: "AbortError" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hostAborted).toBe(true);
	});

	it("times out and rejects pending work when closed", async () => {
		const timeoutPair = createPair(
			{ never: () => new Promise(() => undefined) },
			10,
		);
		await expect(timeoutPair.client.request("never", null)).rejects.toThrow(
			"timed out",
		);

		const closePair = createPair({ never: () => new Promise(() => undefined) });
		const pending = closePair.client.request("never", null);
		await closePair.client.close();
		await expect(pending).rejects.toThrow("closed");
		expect(() => closePair.client.request("never", null)).toThrow("closed");
	});
});
