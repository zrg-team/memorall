import z from "zod";
import type {
	BaseTool,
	ToolSchema,
	ToolBinding,
	ToolFactory,
	ToolResultValue,
} from "flow-core/interfaces/engine/tool";
import {
	isJsonToolSchema,
	parseToolInput,
} from "flow-core/interfaces/engine/tool";
import type { ChatCompletionTool } from "flow-core/interfaces/engine/messages";
import { logWarn } from "flow-core/utils/logger";

// Global tool type registry for smart type inference
// Tool modules extend this interface to register their tool types and required services
declare global {
	interface ToolTypeRegistry {
		// Empty by default - tools will extend this interface
		// Example: 'calculator': { input: CalculatorInput; services: undefined; };
	}
}

// Internal factory storage type
type StoredFactory = (services: unknown, config?: unknown) => BaseTool;
type ToolConfig<T extends keyof ToolTypeRegistry> =
	ToolTypeRegistry[T] extends { config: infer C } ? C : void;
type ToolSpecifier = string | ToolBinding<string, unknown>;
type JsonSchema = Record<string, unknown>;

export interface ToolRegistration<
	T extends keyof ToolTypeRegistry = keyof ToolTypeRegistry,
> {
	id: T;
	name: string;
	factory: ToolFactory<
		ToolTypeRegistry[T]["input"],
		ToolTypeRegistry[T]["services"],
		ToolConfig<T>
	>;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface RegisteredTool {
	id: string;
	name: string;
	factory: StoredFactory;
	config: Record<string, unknown>;
	metadata: Record<string, unknown>;
}

export type ToolRegistryPredicate = (entry: RegisteredTool) => boolean;

const isOptionalSchema = (schema: z.ZodTypeAny): boolean => {
	if (schema instanceof z.ZodOptional) return true;
	if (schema instanceof z.ZodDefault) return true;
	if (schema instanceof z.ZodNullable) return true;
	return false;
};

const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
	const def = (
		schema as {
			_def?: {
				innerType?: z.ZodTypeAny;
				schema?: z.ZodTypeAny;
				typeName?: string;
			};
		}
	)._def;
	if (schema instanceof z.ZodOptional && def?.innerType)
		return unwrapSchema(def.innerType);
	if (schema instanceof z.ZodDefault && def?.innerType)
		return unwrapSchema(def.innerType);
	if (schema instanceof z.ZodNullable && def?.innerType)
		return unwrapSchema(def.innerType);
	if (def?.typeName === "ZodEffects" && def.schema)
		return unwrapSchema(def.schema);
	return schema;
};

const toJsonSchema = (schema: ToolSchema): Record<string, unknown> => {
	if (isJsonToolSchema(schema)) {
		return schema.jsonSchema;
	}

	const unwrapped = unwrapSchema(schema);

	if (unwrapped instanceof z.ZodString) {
		return { type: "string" };
	}
	if (unwrapped instanceof z.ZodNumber) {
		return { type: "number" };
	}
	if (unwrapped instanceof z.ZodBoolean) {
		return { type: "boolean" };
	}
	if (unwrapped instanceof z.ZodEnum) {
		return { type: "string", enum: unwrapped.options };
	}
	if (unwrapped instanceof z.ZodLiteral) {
		const value = unwrapped.value;
		const type = typeof value;
		return { type, enum: [value] };
	}
	if (unwrapped instanceof z.ZodAny || unwrapped instanceof z.ZodUnknown) {
		return {};
	}
	if (unwrapped instanceof z.ZodUnion) {
		const options = (unwrapped as unknown as { options: z.ZodTypeAny[] })
			.options;
		return { anyOf: options.map((opt: z.ZodTypeAny) => toJsonSchema(opt)) };
	}
	if (unwrapped instanceof z.ZodRecord) {
		const valueType = (
			unwrapped as unknown as { _def?: { valueType?: z.ZodTypeAny } }
		)._def?.valueType;
		return {
			type: "object",
			additionalProperties: toJsonSchema(valueType ?? z.unknown()),
		};
	}
	if (unwrapped instanceof z.ZodArray) {
		const itemSchema = (
			unwrapped as unknown as {
				_def?: { element?: z.ZodTypeAny; type?: z.ZodTypeAny };
			}
		)._def;
		const elementSchema = itemSchema?.element ?? itemSchema?.type;
		return { type: "array", items: toJsonSchema(elementSchema ?? z.any()) };
	}
	if (unwrapped instanceof z.ZodObject) {
		const rawShape = (unwrapped as { _def?: { shape?: unknown } })._def?.shape;
		const shape =
			typeof rawShape === "function"
				? (rawShape as () => Record<string, z.ZodTypeAny>)()
				: (rawShape as Record<string, z.ZodTypeAny>);
		const properties: Record<string, JsonSchema> = {};
		const required: string[] = [];

		for (const [key, value] of Object.entries(shape ?? {})) {
			properties[key] = toJsonSchema(value as z.ZodTypeAny);
			if (!isOptionalSchema(value as z.ZodTypeAny)) {
				required.push(key);
			}
		}

		const result: JsonSchema = {
			type: "object",
			properties,
		};
		if (required.length) {
			result.required = required;
		}
		return result;
	}

	return {};
};

const toOpenAIToolParameters = (schema: ToolSchema): Record<string, unknown> =>
	toJsonSchema(schema);

/**
 * Convert tools to OpenAI ChatCompletionTool format
 */
export function convertToolsToOpenAI(tools: BaseTool[]): ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: toOpenAIToolParameters(tool.schema),
		},
	}));
}

// Registry class using singleton pattern
export class ToolRegistryManager {
	private static instance: ToolRegistryManager;
	private entries = new Map<string, RegisteredTool>();
	private finalized = false;

	constructor() {}

	private assertMutable(action: string): void {
		if (this.finalized) {
			throw new Error(`[ToolRegistry] Cannot ${action} after finalization`);
		}
	}

	finalize(): this {
		this.finalized = true;
		return this;
	}

	isFinalized(): boolean {
		return this.finalized;
	}

	static getInstance(): ToolRegistryManager {
		if (!ToolRegistryManager.instance) {
			ToolRegistryManager.instance = new ToolRegistryManager();
		}
		return ToolRegistryManager.instance;
	}

	/**
	 * Register a tool factory
	 */
	register<T extends keyof ToolTypeRegistry>(
		toolName: T,
		factory: ToolRegistration<T>["factory"],
		metadata?: Record<string, unknown>,
	): void {
		this.assertMutable("register tool");
		const normalizedFactory: StoredFactory = (
			services: unknown,
			config?: unknown,
		) => (factory as (s?: unknown, c?: unknown) => BaseTool)(services, config);
		if (this.entries.has(toolName as string)) {
			logWarn(
				`[ToolRegistry] "${String(toolName)}" already registered — overwriting`,
			);
		}
		this.entries.set(toolName as string, {
			id: toolName as string,
			name: toolName as string,
			factory: normalizedFactory,
			config: {},
			metadata: metadata ?? {},
		});
	}

	setEntry(entry: RegisteredTool): void {
		this.assertMutable("set entry");
		this.entries.set(entry.id, {
			...entry,
			config: { ...entry.config },
			metadata: { ...entry.metadata },
		});
	}

	/**
	 * Get a tool instance with services bound (type-safe version)
	 */
	getTool<T extends keyof ToolTypeRegistry>(
		toolName: T,
		services: ToolTypeRegistry[T]["services"],
		config?: ToolConfig<T>,
	): BaseTool {
		const entry = this.entries.get(toolName as string);
		if (!entry) {
			throw new Error(`No tool registered for name: ${String(toolName)}`);
		}
		return entry.factory(services, config);
	}

	/**
	 * Get a tool by name with services (loose typing for dynamic access)
	 */
	getToolByName(
		toolName: string,
		services?: unknown,
		config?: unknown,
	): BaseTool {
		const entry = this.entries.get(toolName);
		if (!entry) {
			throw new Error(`No tool registered for name: ${toolName}`);
		}
		return entry.factory(services, config);
	}

	/**
	 * Get multiple tools by name with services bound
	 */
	getTools(
		toolNames: readonly ToolSpecifier[],
		services?: unknown,
	): BaseTool[] {
		return toolNames.map((tool) =>
			typeof tool === "string"
				? this.getToolByName(tool, services)
				: this.getToolByName(tool.name, services, tool.config),
		);
	}

	/**
	 * Get all registered tool names
	 */
	getRegisteredToolNames(): string[] {
		return Array.from(this.entries.keys());
	}

	/**
	 * Check if a tool is registered
	 */
	hasToolName(toolName: string): boolean {
		return this.entries.has(toolName);
	}

	get(id: string): RegisteredTool | undefined {
		return this.entries.get(id);
	}

	getAll(): RegisteredTool[] {
		return Array.from(this.entries.values());
	}

	has(id: string): boolean {
		return this.hasToolName(id);
	}

	clear(): void {
		this.assertMutable("clear registry");
		this.entries.clear();
	}

	fork(predicate?: ToolRegistryPredicate): ToolRegistryManager {
		const next = new ToolRegistryManager();
		for (const entry of this.getAll()) {
			if (!predicate || predicate(entry)) {
				next.setEntry(entry);
			}
		}
		return next;
	}

	/**
	 * Execute a tool by name
	 */
	async executeToolByName<T extends keyof ToolTypeRegistry>(
		toolName: T,
		args: ToolTypeRegistry[T]["input"],
		services: ToolTypeRegistry[T]["services"],
		config?: ToolConfig<T>,
	): Promise<ToolResultValue> {
		const tool = this.getTool(toolName, services, config);
		const validatedArgs = parseToolInput<ToolTypeRegistry[T]["input"]>(
			tool.schema,
			args,
		);
		return tool.execute(validatedArgs);
	}
}

export const toolRegistry = ToolRegistryManager.getInstance();
