import { HarnessError } from "./errors.js";
import type { HarnessGraphDefinition } from "./graph.js";
import type { BaseTool, ToolFactory } from "./tool.js";
import type { HarnessStepDefinition } from "./step.js";

class FrozenRegistry<T extends { readonly id?: string; readonly name?: string }> {
  readonly #entries = new Map<string, T>();
  #frozen = false;

  register(id: string, value: T): void {
    if (this.#frozen) throw new HarnessError("runtime_closed", "Registry is frozen");
    if (this.#entries.has(id)) {
      throw new HarnessError("duplicate_registration", `Duplicate registration: ${id}`, {
        details: { id },
      });
    }
    this.#entries.set(id, value);
  }

  get(id: string): T | undefined {
    return this.#entries.get(id);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  entries(): readonly T[] {
    return [...this.#entries.values()];
  }

  freeze(): void {
    this.#frozen = true;
  }
}

export class ToolRegistry {
  readonly #registry = new FrozenRegistry<{ readonly name: string; readonly factory: ToolFactory }>();

  register(name: string, factory: ToolFactory): void {
    this.#registry.register(name, { name, factory });
  }

  create(name: string, services: Parameters<ToolFactory>[0]): BaseTool {
    const registration = this.#registry.get(name);
    if (!registration) throw new HarnessError("tool_not_found", `Tool is not registered: ${name}`);
    return registration.factory(services);
  }

  has(name: string): boolean {
    return this.#registry.has(name);
  }

  names(): readonly string[] {
    return this.#registry.entries().map((entry) => entry.name);
  }

  freeze(): void {
    this.#registry.freeze();
  }
}

export class GraphRegistry {
  readonly #registry = new FrozenRegistry<HarnessGraphDefinition>();

  register(graph: HarnessGraphDefinition): void {
    this.#registry.register(graph.id, graph);
  }

  get(id: string): HarnessGraphDefinition | undefined {
    return this.#registry.get(id);
  }

  entries(): readonly HarnessGraphDefinition[] {
    return this.#registry.entries();
  }

  freeze(): void {
    this.#registry.freeze();
  }
}

export class StepRegistry {
  readonly #registry = new FrozenRegistry<HarnessStepDefinition>();

  register(step: HarnessStepDefinition): void {
    this.#registry.register(step.id, step);
  }

  get(id: string): HarnessStepDefinition | undefined {
    return this.#registry.get(id);
  }

  entries(): readonly HarnessStepDefinition[] {
    return this.#registry.entries();
  }

  freeze(): void {
    this.#registry.freeze();
  }
}

export interface HarnessRegistries {
  readonly tools: ToolRegistry;
  readonly graphs: GraphRegistry;
  readonly steps: StepRegistry;
}

export const createHarnessRegistries = (): HarnessRegistries => ({
  tools: new ToolRegistry(),
  graphs: new GraphRegistry(),
  steps: new StepRegistry(),
});

export const freezeHarnessRegistries = (registries: HarnessRegistries): void => {
  registries.tools.freeze();
  registries.graphs.freeze();
  registries.steps.freeze();
};
