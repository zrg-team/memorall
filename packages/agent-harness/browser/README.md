# 🌐 Agent Harness Browser

> Browser and worker adapters built only on standard Web APIs.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-browser`

This package connects portable harness contracts to browser primitives. It does
not import Chrome extension APIs, application services, React, or a model SDK.

## ✨ Included Adapters

| Export | Purpose | Page | Worker |
|---|---|:---:|:---:|
| `createBrowserPlatform()` | clock, UUID, timers, optional fetch | ✅ | ✅ |
| `OpfsFileSystem` | portable filesystem backed by OPFS | ✅ | ✅* |
| `IndexedDbCheckpointStore` | durable run checkpoints | ✅ | ✅ |
| `IndexedDbEventStore` | durable paginated run events | ✅ | ✅ |
| `DomHtmlContentProcessor` | selector-based text/clean HTML extraction | ✅ | ❌ |

`*` OPFS availability depends on the target browser and worker context.

## 🚀 Compose A Browser Host

```ts
import {
  DomHtmlContentProcessor,
  IndexedDbCheckpointStore,
  IndexedDbEventStore,
  OpfsFileSystem,
  createBrowserPlatform,
} from "@memorall/agent-harness-browser";
import {
  FILESYSTEM_SERVICE,
  HTML_CONTENT_PROCESSOR,
} from "@memorall/agent-harness-standard";

const platform = createBrowserPlatform();
const checkpointStore = new IndexedDbCheckpointStore({
  databaseName: "my-agent",
});
const eventStore = new IndexedDbEventStore({ databaseName: "my-agent" });

const services = {
  [FILESYSTEM_SERVICE.id]: new OpfsFileSystem(),
  [HTML_CONTENT_PROCESSOR.id]: new DomHtmlContentProcessor(),
};
```

Pass these values to `createHarness()` or `createFullHarness()`. Supply a model
adapter separately through `MODEL_SERVICE`.

## 🧵 Worker Guidance

Create the platform with `runtime: "worker"` when auto-detection is not
appropriate. Do not bind `DomHtmlContentProcessor` where `DOMParser` is absent;
inject another `HtmlContentProcessor` or leave DOM extraction unadvertised.

## 🛡️ Boundary

Browser extension tabs, service-worker messaging, offscreen documents, and
AlmostNode transports are host adapters, not responsibilities of this package.
That separation keeps the same harness usable in a normal web app.
