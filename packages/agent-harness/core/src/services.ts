import { HarnessError } from "./errors.js";

export interface ServiceToken<T> {
  readonly id: string;
  readonly description?: string;
  readonly optional?: boolean;
  readonly __service?: T;
}

export const createServiceToken = <T>(
  id: string,
  options: { description?: string; optional?: boolean } = {},
): ServiceToken<T> => Object.freeze({ id, ...options });

export type ServiceBindings = Readonly<Record<string, unknown>>;

export class ServiceResolver {
  readonly #bindings: ReadonlyMap<string, unknown>;

  constructor(...bindings: Array<ServiceBindings | undefined>) {
    const merged = new Map<string, unknown>();
    for (const values of bindings) {
      for (const [id, value] of Object.entries(values ?? {})) {
        if (value !== undefined) merged.set(id, value);
      }
    }
    this.#bindings = merged;
  }

  has(token: ServiceToken<unknown> | string): boolean {
    return this.#bindings.has(typeof token === "string" ? token : token.id);
  }

  optional<T>(token: ServiceToken<T>): T | undefined {
    return this.#bindings.get(token.id) as T | undefined;
  }

  get<T>(token: ServiceToken<T>): T {
    const value = this.optional(token);
    if (value === undefined) {
      throw new HarnessError("missing_service", `Required service is not bound: ${token.id}`, {
        details: { serviceId: token.id },
      });
    }
    return value;
  }

  snapshot(): ServiceBindings {
    return Object.freeze(Object.fromEntries(this.#bindings));
  }
}

export interface HarnessLogger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}
