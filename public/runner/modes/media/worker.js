// Media runner worker: keeps WASM/WebGPU inference off the runner frame, which
// shares the extension offscreen document's event loop with the database and
// background jobs.
import { createMediaEngine } from "./engine.js";
import { serveEngineOnPort } from "./engine-port.js";

serveEngineOnPort(self, createMediaEngine);
