/**
 * ServiceRegistry — globally augmentable, same pattern as ToolTypeRegistry / StepTypeRegistry.
 *
 * Each interface file in this folder registers itself:
 *   - llm.ts        → ServiceRegistry.llm
 *   - logger.ts     → ServiceRegistry.logger
 *   - filesystem.ts → ServiceRegistry.fs?
 *   - web-browser.ts → ServiceRegistry.webBrowser?
 *   - sandbox.ts    → ServiceRegistry.sandboxContainer?
 *   - skill.ts      → ServiceRegistry.skillService?
 *   - flow-catalog.ts  → ServiceRegistry.flowCatalog?
 *
 * Other packages extend it without touching this file:
 *   flows-memory:       database?, embedding?
 *   flows-integrations: documentProcessor?
 */

/** All services available to tools and steps at runtime */
export type AllServices = ServiceRegistry;

export {};
