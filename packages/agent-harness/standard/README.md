# 🧰 Agent Harness Standard Capabilities

> Useful agent abilities with portable contracts and replaceable host services.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-standard`

Standard capabilities are opt-in building blocks, not a product preset. Tools
contain model-facing validation and result shaping; filesystem, browser, skill,
compaction, and child-agent behavior enters through service tokens.

## ✨ Capability Catalog

| Capability | Tools or steps | Required service |
|---|---|---|
| 💬 Chat | `add-system`, `current-time` | none |
| 📁 Filesystem | `fs_read`, `fs_write`, `fs_edit`, `fs_ls`, `fs_glob`, `fs_grep`, `fs_mkdir`, `fs_remove` | `FILESYSTEM_SERVICE` |
| 🌐 Web | `web_open`, `web_read`, `web_search`, `web_dom`, `web_wait` | `WEB_BROWSER_SERVICE`, optional HTML processor |
| 📋 Planner | create/get/add/check/remove plan tools | run-local state |
| 🧠 Skills | `load_skill` | `SKILL_SERVICE` |
| 🗜️ Compaction | `auto-compact` step | `COMPACTION_SERVICE` |
| 🤝 Delegation | `send_message_to_agent` | `CHILD_AGENT_SERVICE` |

## 🎛️ Select Only What You Need

```ts
import { standardToolsPlugin } from "@memorall/agent-harness-standard";

const standard = standardToolsPlugin({
  chat: { content: "Be concise and verify tool results." },
  filesystem: true,
  planner: true,
  web: false,
  skills: false,
  compaction: false,
  multiAgent: false,
});
```

The aggregate plugin enables capabilities by default, so explicitly set
unneeded features to `false` for the clearest model surface and smallest bundle.
You can also import focused subpaths such as
`@memorall/agent-harness-standard/filesystem`.

## 🔌 Bind A Portable Service

```ts
import { FILESYSTEM_SERVICE } from "@memorall/agent-harness-standard/filesystem";
import { NodeFileSystem } from "@memorall/agent-harness-node";

const services = {
  [FILESYSTEM_SERVICE.id]: new NodeFileSystem(),
};
```

Use `OpfsFileSystem` from the
[`browser` package](../browser/README.md) to keep the same tools in a browser.
The graph and model-facing schema do not change when the host implementation
changes.

## 📦 Focused Exports

`./chat`, `./filesystem`, `./web`, `./planner`, `./skills`, `./compaction`, and
`./multi-agent` are public subpaths. Importing one does not register it; call its
plugin factory and pass the result to `createHarness()`.

## 🛡️ Design Boundary

This package owns domain-neutral agent abilities only. Concrete browser tabs,
Chrome extension APIs, document databases, prompts, credentials, and UI policy
remain outside the workspace.

## 🛠️ Develop Standard Capabilities

```bash
yarn workspace @memorall/agent-harness-standard dev
yarn workspace @memorall/agent-harness-standard test
yarn workspace @memorall/agent-harness-standard build
```

The watcher builds referenced harness packages first and then incrementally
refreshes the capability package's `dist/` exports.
