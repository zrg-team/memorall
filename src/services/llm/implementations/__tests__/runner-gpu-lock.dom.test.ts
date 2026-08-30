import { afterEach, describe, expect, it } from "vitest";
import { unloadTransformerModel } from "../../../../../public/runner/modes/transformmers/model-loader.js";

/**
 * A faithful-enough Web Locks stand-in: exclusive, FIFO, released when the
 * callback settles.
 */
function installSerializingLocks() {
	let queue: Promise<unknown> = Promise.resolve();
	const request = (_name: string, fn: () => Promise<unknown>) => {
		const run = queue.then(() => fn());
		queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};

	Object.defineProperty(navigator, "locks", {
		configurable: true,
		value: { request },
	});
}

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

afterEach(() => {
	Reflect.deleteProperty(navigator, "locks");
});

describe("transformer model disposal", () => {
	it("waits for the GPU lock before releasing a WebGPU session", async () => {
		installSerializingLocks();
		const events: string[] = [];
		const holderDone = deferred();

		// Another runner is mid-generation and holds the lock.
		const holder = navigator.locks!.request("memorall-webgpu-inference", () =>
			holderDone.promise.then(() => {
				events.push("generation finished");
			}),
		);

		const unload = unloadTransformerModel({
			device: "webgpu",
			model: {
				dispose: () => {
					events.push("model disposed");
				},
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		// The lifecycle manager unloads on an idle timer; disposing here would
		// invalidate the device instance the other runner is still using.
		expect(events).toEqual([]);

		holderDone.resolve();
		await Promise.all([holder, unload]);

		expect(events).toEqual(["generation finished", "model disposed"]);
	});

	it("does not queue a CPU session behind GPU work", async () => {
		installSerializingLocks();
		const events: string[] = [];
		const holderDone = deferred();

		const holder = navigator.locks!.request(
			"memorall-webgpu-inference",
			() => holderDone.promise,
		);

		await unloadTransformerModel({
			device: "wasm",
			model: {
				dispose: () => {
					events.push("model disposed");
				},
			},
		});

		expect(events).toEqual(["model disposed"]);

		holderDone.resolve();
		await holder;
	});
});
