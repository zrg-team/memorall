// Core tools — register on import
import { toolRegistry } from "../registries/tool-registry.js";
import "./calculator.js";
import "./current-time.js";
import "./load-skill.js";
import "./send-message-to-agent.js";

import "./fs/fs-glob.js";
import "./fs/fs-grep.js";
import "./fs/fs-read.js";
import "./fs/fs-write.js";
import "./fs/fs-edit.js";
import "./fs/fs-mkdir.js";
import "./fs/fs-remove.js";
import "./fs/fs-ls.js";

import "./sandbox-container/container-run-code.js";
import "./sandbox-container/container-execute-command.js";
import "./sandbox-container/container-listen-command.js";
import "./sandbox-container/container-send-command-input.js";
import "./sandbox-container/container-stop-command.js";
import "./sandbox-container/container-list-commands.js";
import "./sandbox-container/container-install-package.js";
import "./sandbox-container/container-start-server.js";
import "./sandbox-container/container-restart-server.js";
import "./sandbox-container/container-stop-server.js";
import "./sandbox-container/container-list-servers.js";
import "./sandbox-container/container-get-logs.js";
import "./sandbox-container/container-clear-logs.js";
import "./sandbox-container/container-exists.js";
import "./sandbox-container/container-fetch-resource.js";
import "./sandbox-container/container-request-server.js";
import "./sandbox-container/container-render-server.js";

import "./agent-sandbox/index.js";

import "./web/web-search-engine.js";
import "./web/web-open.js";
import "./web/web-read.js";
import "./web/web-search.js";
import "./web/web-dom.js";
import "./web/web-wait.js";

import "./planner/index.js";



toolRegistry.markDeprecatedByPrefix("container_", "sandbox_* grouped tools");
