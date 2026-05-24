/**
 * Chat Flow Registry
 *
 * A registry that allows any graph type to expose itself as a "chat-capable"
 * flow.  Each graph module self-registers at the bottom of its graph.ts file
 * by calling `chatFlowRegistry.register(graphType, factory)`.
 *
 * process-chat.ts (and any other chat handler) uses `chatFlowRegistry.create()`
 * to obtain a ready-to-stream graph — zero branching needed in the handler,
 * zero changes required when new graph types are added.
 */

import type { AllServices } from "./interfaces/tool";
import type { BaseFlow } from "./flow-registry";
import type { ChatCompletionMessageParam } from "./interfaces/messages";
import type { UnifiedFlowConfig } from "./interfaces/flow-config";

// Re-export so callers that already import from here don't need to change
export type { UnifiedFlowConfig };

// ---------------------------------------------------------------------------
// Context passed to getInitialState so each adapter can build its own state.
// ---------------------------------------------------------------------------
export interface ChatGraphContext {
	messages: ChatCompletionMessageParam[];
	/** Optional topic / knowledge graph ID used by RAG graphs. */
	topicId?: string;
	/** Additional retrieval hint queries (e.g. topic description). */
	contextQueries: string[];
}

// ---------------------------------------------------------------------------
// What a registered adapter returns
// ---------------------------------------------------------------------------
export interface ChatGraphResult {
	/** Compiled, ready-to-stream graph. */
	graph: BaseFlow;
	/** Build the initial state object to pass to graph.stream(). */
	getInitialState(ctx: ChatGraphContext): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory signature every graph must implement to register
// ---------------------------------------------------------------------------
export type ChatFlowFactory = (
	services: AllServices,
	config: UnifiedFlowConfig,
) => ChatGraphResult;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
class ChatFlowRegistry {
	private factories = new Map<string, ChatFlowFactory>();

	/**
	 * Register a graph type as a chat-capable flow.
	 * Called once per graph module (self-registration pattern).
	 */
	register(graphType: string, factory: ChatFlowFactory): void {
		this.factories.set(graphType, factory);
	}

	/**
	 * Create a ChatGraphResult for the requested graphType.
	 * Falls back to "foundation" if the type is unknown.
	 */
	create(
		graphType: string,
		services: AllServices,
		config: UnifiedFlowConfig,
	): ChatGraphResult {
		const factory =
			this.factories.get(graphType) ?? this.factories.get("foundation");
		if (!factory) {
			throw new Error(
				`[ChatFlowRegistry] No chat flow registered for type "${graphType}" and no "foundation" fallback.`,
			);
		}
		return factory(services, config);
	}

	getRegisteredTypes(): string[] {
		return Array.from(this.factories.keys());
	}

	has(graphType: string): boolean {
		return this.factories.has(graphType);
	}
}

export const chatFlowRegistry = new ChatFlowRegistry();
