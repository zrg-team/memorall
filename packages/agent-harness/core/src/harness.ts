import { BoundedAsyncQueue } from "./async-queue.js";
import {
  HarnessError,
  serializeHarnessError,
  throwIfCancelled,
} from "./errors.js";
import type { HarnessEvent, HarnessEventSink } from "./events.js";
import type {
  HarnessGraphDefinition,
  HarnessGraphExecutionResult,
} from "./graph.js";
import { assertJsonValue, type JsonValue } from "./json.js";
import { mergeHarnessLimits, type HarnessLimits } from "./limits.js";
import { RunLifecycle } from "./lifecycle.js";
import type {
  HarnessCheckpoint,
  HarnessCheckpointStore,
  HarnessEventStore,
} from "./persistence.js";
import type { HarnessPlatform } from "./platform.js";
import { installPlugins, type HarnessPlugin } from "./plugins.js";
import {
  createHarnessRegistries,
  freezeHarnessRegistries,
  type HarnessRegistries,
} from "./registries.js";
import { RunContext } from "./runtime-context.js";
import {
  ServiceResolver,
  type ServiceBindings,
  type ServiceToken,
} from "./services.js";

export interface HarnessRunRequest {
  runId?: string;
  graph: string;
  input: unknown;
  scope?: Readonly<Record<string, string>>;
  services?: ServiceBindings;
  deadlineMs?: number;
  signal?: AbortSignal;
  checkpoint?: string;
}

export interface HarnessRunResult {
  runId: string;
  output: JsonValue;
  checkpointId?: string;
}

export interface HarnessRun extends AsyncIterable<HarnessEvent> {
  readonly id: string;
  result(): Promise<HarnessRunResult>;
  cancel(reason?: string): Promise<void>;
}

export interface HarnessDescriptor {
  contractVersion: 1;
  plugins: Readonly<Record<string, string>>;
  graphs: readonly { id: string; version: string; description?: string }[];
  steps: readonly { id: string; version: string; description?: string }[];
  tools: readonly string[];
  requiredServices: readonly string[];
  limits: HarnessLimits;
}

export interface CreateHarnessOptions {
  platform: HarnessPlatform;
  plugins?: readonly HarnessPlugin[];
  services?: ServiceBindings;
  limits?: Partial<HarnessLimits>;
  checkpointStore?: HarnessCheckpointStore;
  eventStore?: HarnessEventStore;
}

export interface AgentHarness {
  run(request: HarnessRunRequest): HarnessRun;
  inspect(): HarnessDescriptor;
  close(): Promise<void>;
}

class HarnessRunHandle implements HarnessRun {
  readonly #queue: BoundedAsyncQueue<HarnessEvent>;
  readonly #controller: AbortController;
  readonly #resultPromise: Promise<HarnessRunResult>;
  #consumerAttached = false;
  #draining = false;

  constructor(
    readonly id: string,
    queue: BoundedAsyncQueue<HarnessEvent>,
    controller: AbortController,
    result: Promise<HarnessRunResult>,
  ) {
    this.#queue = queue;
    this.#controller = controller;
    this.#resultPromise = result;
  }

  result(): Promise<HarnessRunResult> {
    if (!this.#consumerAttached) this.#startDrain();
    return this.#resultPromise;
  }

  async cancel(reason = "cancelled by host"): Promise<void> {
    this.#controller.abort(reason);
    try {
      await this.#resultPromise;
    } catch {
      // Cancellation is reflected by result() and run.failed.
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<HarnessEvent> {
    if (this.#consumerAttached) throw new Error("HarnessRun supports one event consumer");
    this.#consumerAttached = true;
    return {
      next: () => this.#queue.next(),
      return: async () => {
        this.#controller.abort("event consumer stopped early");
        this.#startDrain();
        return { value: undefined, done: true };
      },
    };
  }

  #startDrain(): void {
    if (this.#draining) return;
    this.#draining = true;
    this.#consumerAttached = true;
    void (async () => {
      while (!(await this.#queue.next()).done) {
        // result() deliberately discards events when no stream consumer exists.
      }
    })();
  }
}

const compareCheckpoint = (
  checkpoint: HarnessCheckpoint,
  graph: HarnessGraphDefinition,
  plugins: Readonly<Record<string, string>>,
): void => {
  const versionsMatch =
    Object.keys(checkpoint.pluginVersions).length === Object.keys(plugins).length &&
    Object.entries(plugins).every(([id, version]) => checkpoint.pluginVersions[id] === version);
  if (
    checkpoint.contractVersion !== 1 ||
    checkpoint.graphId !== graph.id ||
    checkpoint.graphVersion !== graph.version ||
    !versionsMatch
  ) {
    throw new HarnessError(
      "checkpoint_incompatible",
      `Checkpoint ${checkpoint.id} is incompatible with graph ${graph.id}`,
      { details: { checkpointId: checkpoint.id, graphId: graph.id } },
    );
  }
};

const validateRequiredServices = (
  resolver: ServiceResolver,
  tokens: readonly ServiceToken<unknown>[],
): void => {
  for (const token of tokens) {
    if (!token.optional && !resolver.has(token)) resolver.get(token);
  }
};

export const createHarness = (options: CreateHarnessOptions): AgentHarness => {
  const registries: HarnessRegistries = createHarnessRegistries();
  const installed = installPlugins(options.plugins ?? [], registries);
  freezeHarnessRegistries(registries);
  const limits = mergeHarnessLimits(options.limits);
  const baseServices = new ServiceResolver(options.services).snapshot();
  const activeRuns = new Map<string, HarnessRunHandle>();
  let closed = false;

  const inspect = (): HarnessDescriptor =>
    Object.freeze({
      contractVersion: 1 as const,
      plugins: installed.versions,
      graphs: Object.freeze(
        registries.graphs.entries().map(({ id, version, description }) => ({
          id,
          version,
          ...(description ? { description } : {}),
        })),
      ),
      steps: Object.freeze(
        registries.steps.entries().map(({ id, version, description }) => ({
          id,
          version,
          ...(description ? { description } : {}),
        })),
      ),
      tools: Object.freeze([...registries.tools.names()]),
      requiredServices: Object.freeze(installed.requiredServices.map(({ id }) => id)),
      limits,
    });

  const run = (request: HarnessRunRequest): HarnessRun => {
    if (closed) throw new HarnessError("runtime_closed", "Harness is closed");
    const graph = registries.graphs.get(request.graph);
    if (!graph) {
      throw new HarnessError("graph_not_found", `Graph is not registered: ${request.graph}`);
    }
    const runId = request.runId ?? options.platform.randomUUID();
    if (activeRuns.has(runId)) {
      throw new HarnessError("duplicate_registration", `Run ID is already active: ${runId}`);
    }

    const queue = new BoundedAsyncQueue<HarnessEvent>(limits.maxBufferedEvents);
    const controller = new AbortController();
    const externalAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", externalAbort, { once: true });
    const maxDeadline = limits.maxRunMs === undefined ? undefined : options.platform.now() + limits.maxRunMs;
    const deadlineMs =
      request.deadlineMs === undefined
        ? maxDeadline
        : maxDeadline === undefined
          ? request.deadlineMs
          : Math.min(request.deadlineMs, maxDeadline);
    const timer =
      deadlineMs === undefined
        ? undefined
        : options.platform.schedule(Math.max(0, deadlineMs - options.platform.now()), () =>
            controller.abort("deadline exceeded"),
          );
    const services = new ServiceResolver(baseServices, request.services);
    const lifecycle = new RunLifecycle();

    const emit: HarnessEventSink["emit"] = async (event) => {
      assertJsonValue(event, "Harness event");
      await options.eventStore?.append(runId, [event]);
      await queue.push(event);
    };
    const events: HarnessEventSink = { emit };

    const execute = async (): Promise<HarnessRunResult> => {
      let result: HarnessGraphExecutionResult | undefined;
      try {
        validateRequiredServices(services, installed.requiredServices);
        validateRequiredServices(services, graph.requiredServices ?? []);
        throwIfCancelled(controller.signal, deadlineMs, () => options.platform.now());
        const checkpoint = request.checkpoint
          ? await options.checkpointStore?.load(request.checkpoint)
          : undefined;
        if (request.checkpoint && !checkpoint) {
          throw new HarnessError("checkpoint_incompatible", `Checkpoint not found: ${request.checkpoint}`);
        }
        if (checkpoint) compareCheckpoint(checkpoint, graph, installed.versions);

        await emit({
          type: "run.started",
          runId,
          graphId: graph.id,
          timestamp: options.platform.now(),
        });
        result = await graph.execute({
          runId,
          input: request.input,
          scope: Object.freeze({ ...(request.scope ?? {}) }),
          signal: controller.signal,
          deadlineMs,
          services,
          platform: options.platform,
          events,
          lifecycle,
          runtime: new RunContext(),
          limits,
          tools: registries.tools,
          steps: registries.steps,
          checkpoint,
        });
        assertJsonValue(result.output, "Harness graph output");
        throwIfCancelled(controller.signal, deadlineMs, () => options.platform.now());

        let checkpointId: string | undefined;
        if (result.checkpointState !== undefined && options.checkpointStore) {
          assertJsonValue(result.checkpointState, "Harness checkpoint state");
          checkpointId = `${runId}:${options.platform.randomUUID()}`;
          await options.checkpointStore.save({
            contractVersion: 1,
            id: checkpointId,
            runId,
            graphId: graph.id,
            graphVersion: graph.version,
            pluginVersions: installed.versions,
            state: result.checkpointState,
            providerContinuations: result.providerContinuations,
            createdAt: options.platform.now(),
          });
        }
        await emit({
          type: "run.completed",
          runId,
          result: result.output,
          timestamp: options.platform.now(),
        });
        return { runId, output: result.output, ...(checkpointId ? { checkpointId } : {}) };
      } catch (error) {
        const normalized =
          controller.signal.aborted && !(error instanceof HarnessError)
            ? new HarnessError("cancelled", String(controller.signal.reason ?? "cancelled"), {
                cause: error,
              })
            : error;
        await emit({
          type: "run.failed",
          runId,
          error: serializeHarnessError(normalized),
          timestamp: options.platform.now(),
        });
        throw normalized;
      } finally {
        await lifecycle.drain();
        timer?.cancel();
        request.signal?.removeEventListener("abort", externalAbort);
        queue.close();
        activeRuns.delete(runId);
      }
    };

    const resultPromise = Promise.resolve().then(execute);
    const handle = new HarnessRunHandle(runId, queue, controller, resultPromise);
    activeRuns.set(runId, handle);
    return handle;
  };

  return {
    run,
    inspect,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([...activeRuns.values()].map((active) => active.cancel("harness closed")));
    },
  };
};
