import type { ChatCompletionChunk } from "@/types/openai";
import {
	Annotation,
	BaseCheckpointSaver,
	END,
	START,
	StateGraph,
} from "@langchain/langgraph/web";

export interface BaseStateBase {
	finalMessage: string;
	actions?: Array<{
		id: string;
		name: string;
		description?: string;
		metadata?: Record<string, unknown>;
	}>;
}
export const BaseAnnotation = {
	finalMessage: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	actions: Annotation<BaseStateBase["actions"]>({
		value: (x, y) => {
			if (!x) return y ?? [];
			if (!y) return x;
			// Merge with id deduplication
			const ids = new Set(x.map((a) => a.id));
			y.forEach((a) => {
				if (!ids.has(a.id)) {
					x.push(a);
					ids.add(a.id);
				}
			});
			return x.concat(y);
		},
		default: () => [],
	}),
};
export interface Callbacks {
	onNewChunk?: (chunk: ChatCompletionChunk) => void;
}

// Proper LangGraph types
type CompiledGraph<T> = ReturnType<
	StateGraph<T, T, unknown, string | typeof START | typeof END>["compile"]
>;
type LangGraphInvokeResult<T> = ReturnType<CompiledGraph<T>["invoke"]>;
type LangGraphStreamResult<T> = ReturnType<CompiledGraph<T>["stream"]>;

export class GraphBase<N extends string, T extends BaseStateBase, S = unknown> {
	protected workflow!: StateGraph<T, T, unknown, N | typeof START | typeof END>;
	protected app!: CompiledGraph<T>;
	protected services!: S;
	protected callbacks?: Callbacks;
	public abortController = new AbortController();

	constructor(services: S) {
		this.services = services;
	}

	protected compile(
		options?: Parameters<typeof this.workflow.compile>[0],
	): CompiledGraph<T> {
		if (!this.workflow) {
			throw new Error("Workflow is not defined");
		}
		this.app = this.workflow.compile({
			...options,
		});
		return this.app;
	}

	invoke(
		input: Partial<T>,
		options?: { callbacks?: Callbacks },
	): LangGraphInvokeResult<T> {
		const arg = input as Parameters<typeof this.app.invoke>[0];
		if (options?.callbacks) {
			this.callbacks = {
				...this.callbacks,
				...options.callbacks,
			};
		}
		return this.app.invoke(arg);
	}

	stream(
		input: Partial<T>,
		options?: { callbacks?: Callbacks },
	): LangGraphStreamResult<T> {
		const arg = input as Parameters<typeof this.app.stream>[0];
		if (options?.callbacks) {
			this.callbacks = {
				...this.callbacks,
				...options.callbacks,
			};
		}
		return this.app.stream(arg);
	}

	getGraph() {
		return this.app.getGraph();
	}
}
