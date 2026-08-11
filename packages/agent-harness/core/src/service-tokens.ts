import type { ModelService } from "./messages.js";
import { createServiceToken, type HarnessLogger } from "./services.js";

export const MODEL_SERVICE = createServiceToken<ModelService>("llm", {
  description: "Model completion and streaming service",
});

export const LOGGER_SERVICE = createServiceToken<HarnessLogger>("logger", {
  description: "Harness diagnostic logger",
  optional: true,
});
