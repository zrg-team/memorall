import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { logError } from "../interfaces/logger";

export type FlowRunFinishCallback = () => void | Promise<void>;

export type NodeBeforeStartCallback<TState = Record<string, unknown>> = (
	state: TState,
) => Promise<Partial<TState> | void> | Partial<TState> | void;

export type NodeAfterEndCallback<TState = Record<string, unknown>> = (
	state: TState,
	result: Partial<TState>,
) => Promise<Partial<TState> | void> | Partial<TState> | void;

interface NodeListeners {
	beforeStart: Map<string, NodeBeforeStartCallback>;
	afterEnd: Map<string, NodeAfterEndCallback>;
}

export interface FlowRunLifecycle {
	onFinish: (key: string, callback: FlowRunFinishCallback) => void;
	onBeforeStart: (
		key: string,
		nodeName: string,
		callback: NodeBeforeStartCallback,
	) => void;
	onAfterEnd: (
		key: string,
		nodeName: string,
		callback: NodeAfterEndCallback,
	) => void;
	has: (key: string) => boolean;
	drain: () => Promise<void>;
	getNodeListeners: (nodeName: string) => NodeListeners | undefined;
}

export const FLOW_RUN_LIFECYCLE_CONFIG_KEY = "__memorallFlowRunLifecycle";

class DefaultFlowRunLifecycle implements FlowRunLifecycle {
	private readonly finishCallbacks = new Map<string, FlowRunFinishCallback>();
	private readonly nodeListeners = new Map<string, NodeListeners>();
	private isDraining = false;

	onFinish(key: string, callback: FlowRunFinishCallback): void {
		if (this.isDraining || this.finishCallbacks.has(key)) {
			return;
		}
		this.finishCallbacks.set(key, callback);
	}

	onBeforeStart(
		key: string,
		nodeName: string,
		callback: NodeBeforeStartCallback,
	): void {
		if (this.isDraining) return;
		const listeners = this.getOrCreateNodeListeners(nodeName);
		if (listeners.beforeStart.has(key)) return;
		listeners.beforeStart.set(key, callback);
	}

	onAfterEnd(
		key: string,
		nodeName: string,
		callback: NodeAfterEndCallback,
	): void {
		if (this.isDraining) return;
		const listeners = this.getOrCreateNodeListeners(nodeName);
		if (listeners.afterEnd.has(key)) return;
		listeners.afterEnd.set(key, callback);
	}

	has(key: string): boolean {
		return this.finishCallbacks.has(key);
	}

	getNodeListeners(nodeName: string): NodeListeners | undefined {
		return this.nodeListeners.get(nodeName);
	}

	private getOrCreateNodeListeners(nodeName: string): NodeListeners {
		const existing = this.nodeListeners.get(nodeName);
		if (existing) return existing;
		const listeners: NodeListeners = {
			beforeStart: new Map(),
			afterEnd: new Map(),
		};
		this.nodeListeners.set(nodeName, listeners);
		return listeners;
	}

	async drain(): Promise<void> {
		if (this.isDraining) {
			return;
		}
		this.isDraining = true;

		const entries = Array.from(this.finishCallbacks.entries()).reverse();
		this.finishCallbacks.clear();

		for (const [key, callback] of entries) {
			try {
				await callback();
			} catch (error) {
				logError(`[FLOW_RUN_LIFECYCLE] Finish callback failed: ${key}`, error);
			}
		}
	}
}

const isFlowRunLifecycle = (value: unknown): value is FlowRunLifecycle => {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Partial<FlowRunLifecycle>;
	return (
		typeof candidate.onFinish === "function" &&
		typeof candidate.has === "function" &&
		typeof candidate.drain === "function" &&
		typeof candidate.onBeforeStart === "function" &&
		typeof candidate.onAfterEnd === "function" &&
		typeof candidate.getNodeListeners === "function"
	);
};

export const createFlowRunLifecycle = (): FlowRunLifecycle =>
	new DefaultFlowRunLifecycle();

export const getFlowRunLifecycle = (
	runConfig?: Pick<LangGraphRunnableConfig, "configurable">,
): FlowRunLifecycle | undefined => {
	const configurable = runConfig?.configurable as
		| Record<string, unknown>
		| undefined;
	const lifecycle = configurable?.[FLOW_RUN_LIFECYCLE_CONFIG_KEY];
	return isFlowRunLifecycle(lifecycle) ? lifecycle : undefined;
};

/**
 * Wraps a LangGraph node function with lifecycle hook support.
 * Fires onBeforeStart listeners before fn runs (patches merge into local state).
 * Fires onAfterEnd listeners after fn runs (patches merge into result).
 *
 * Note: onBeforeStart patches affect the local state passed to fn only —
 * they do not write back to LangGraph's persisted state store.
 */
export function toNode<TState extends Record<string, unknown>>(
	nodeName: string,
	fn: (
		state: TState,
		config?: LangGraphRunnableConfig,
	) => Promise<Partial<TState>>,
): typeof fn {
	return async (state, runConfig) => {
		const lifecycle = getFlowRunLifecycle(runConfig);
		const listeners = lifecycle?.getNodeListeners(nodeName);

		let current = state;
		if (listeners?.beforeStart.size) {
			for (const cb of listeners.beforeStart.values()) {
				const patch = await (cb as NodeBeforeStartCallback<TState>)(current);
				if (patch) current = { ...current, ...patch };
			}
		}

		const result = await fn(current, runConfig);

		let finalResult = result;
		if (listeners?.afterEnd.size) {
			for (const cb of listeners.afterEnd.values()) {
				const patch = await (cb as NodeAfterEndCallback<TState>)(
					current,
					finalResult,
				);
				if (patch) finalResult = { ...finalResult, ...patch };
			}
		}

		return finalResult;
	};
}
