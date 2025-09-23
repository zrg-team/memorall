import { z } from "zod";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { IEmbeddingService } from "@/services/embedding/interfaces/embedding-service.interface";
import type { DatabaseService } from "@/services/database/database-service";

// All available services
export interface AllServices {
	llm: ILLMService;
	embedding: IEmbeddingService;
	database: DatabaseService;
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
