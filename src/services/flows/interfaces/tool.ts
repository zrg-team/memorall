import { z } from "zod";
import type { llmService } from "../../llm";
import type { embeddingService } from "../../embedding";
import type { databaseService } from "../../database";

// All available services
export interface AllServices {
	llm: typeof llmService;
	embedding: typeof embeddingService;
	database: typeof databaseService;
}

// Base tool interface with generic services
export interface BaseTool<S = void> {
	name: string;
	description: string;
	schema: z.ZodSchema<any>;
	execute: S extends void
		? (input: any) => Promise<string>
		: (input: any, services: S) => Promise<string>;
}

// Typed tool interface for implementation
export interface Tool<T = any, S = void> extends BaseTool<S> {
	schema: z.ZodSchema<T>;
	execute: S extends void
		? (input: T) => Promise<string>
		: (input: T, services: S) => Promise<string>;
}
