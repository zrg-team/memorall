import { describe, expect, it } from "vitest";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { BaseStateBase } from "../graph/graph.base.js";
import { GraphBase } from "../graph/graph.base.js";
import { createFlowRegistries } from "../registries/registry-set.js";
import { getFlowRunLifecycle } from "../runtime/run-lifecycle.js";

type TestState = BaseStateBase;
type AppMock = {
	invoke?: (input: unknown, options?: LangGraphRunnableConfig) => unknown;
	stream?: (
		input: unknown,
		options?: LangGraphRunnableConfig,
	) => Promise<AsyncIterable<unknown>>;
	getGraph?: () => unknown;
};

class TestGraph extends GraphBase<string, TestState, unknown> {
	constructor(app: AppMock) {
		super({}, createFlowRegistries());
		this.app = {
			invoke: app.invoke ?? (async () => ({})),
			stream:
				app.stream ??
				(async () =>
					(async function* () {
						yield {};
					})()),
			getGraph: app.getGraph ?? (() => ({})),
		} as typeof this.app;
	}
}

const input: Partial<TestState> = {
	messages: [],
	outputMessages: [],
	tools: [],
};

describe("GraphBase lifecycle drain", () => {
	it("drains owned lifecycle once after invoke", async () => {
		let drained = 0;
		const graph = new TestGraph({
			invoke: async (_input, options) => {
				getFlowRunLifecycle(options)?.onFinish("finish", () => {
					drained += 1;
				});
				return {};
			},
		});

		await graph.invoke(input);

		expect(drained).toBe(1);
	});

	it("drains owned lifecycle after stream completion", async () => {
		let drained = 0;
		const graph = new TestGraph({
			stream: async (_input, options) => {
				getFlowRunLifecycle(options)?.onFinish("finish", () => {
					drained += 1;
				});
				return (async function* () {
					yield { value: 1 };
				})();
			},
		});

		for await (const _chunk of await graph.stream(input)) {
			// consume stream
		}

		expect(drained).toBe(1);
	});

	it("drains owned lifecycle when stream consumption stops early", async () => {
		let drained = 0;
		const graph = new TestGraph({
			stream: async (_input, options) => {
				getFlowRunLifecycle(options)?.onFinish("finish", () => {
					drained += 1;
				});
				return (async function* () {
					yield { value: 1 };
					yield { value: 2 };
				})();
			},
		});

		const iterator = (await graph.stream(input))[Symbol.asyncIterator]();
		await iterator.next();
		await iterator.return?.();

		expect(drained).toBe(1);
	});

	it("drains owned lifecycle when stream iteration throws", async () => {
		let drained = 0;
		const graph = new TestGraph({
			stream: async (_input, options) => {
				getFlowRunLifecycle(options)?.onFinish("finish", () => {
					drained += 1;
				});
				return (async function* () {
					yield { value: 1 };
					throw new Error("stream failed");
				})();
			},
		});

		await expect(async () => {
			for await (const _chunk of await graph.stream(input)) {
				// consume stream
			}
		}).rejects.toThrow("stream failed");
		expect(drained).toBe(1);
	});
});
