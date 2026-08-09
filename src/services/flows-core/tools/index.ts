// Core tools — register on import
import { toolRegistry } from "flow-core/registries/tool-registry";
import "flow-core/tools/calculator";
import "flow-core/tools/current-time";
import "flow-core/tools/load-skill";
import "flow-core/tools/send-message-to-agent";

import "flow-core/tools/fs/fs-glob";
import "flow-core/tools/fs/fs-grep";
import "flow-core/tools/fs/fs-read";
import "flow-core/tools/fs/fs-write";
import "flow-core/tools/fs/fs-edit";
import "flow-core/tools/fs/fs-mkdir";
import "flow-core/tools/fs/fs-remove";
import "flow-core/tools/fs/fs-ls";

import "flow-core/tools/sandbox-container/container-run-code";
import "flow-core/tools/sandbox-container/container-execute-command";
import "flow-core/tools/sandbox-container/container-listen-command";
import "flow-core/tools/sandbox-container/container-send-command-input";
import "flow-core/tools/sandbox-container/container-stop-command";
import "flow-core/tools/sandbox-container/container-list-commands";
import "flow-core/tools/sandbox-container/container-install-package";
import "flow-core/tools/sandbox-container/container-start-server";
import "flow-core/tools/sandbox-container/container-restart-server";
import "flow-core/tools/sandbox-container/container-stop-server";
import "flow-core/tools/sandbox-container/container-list-servers";
import "flow-core/tools/sandbox-container/container-get-logs";
import "flow-core/tools/sandbox-container/container-clear-logs";
import "flow-core/tools/sandbox-container/container-exists";
import "flow-core/tools/sandbox-container/container-fetch-resource";
import "flow-core/tools/sandbox-container/container-request-server";
import "flow-core/tools/sandbox-container/container-render-server";

import "flow-core/tools/agent-sandbox";

import "flow-core/tools/web/web-search-engine";
import "flow-core/tools/web/web-open";
import "flow-core/tools/web/web-read";
import "flow-core/tools/web/web-search";
import "flow-core/tools/web/web-dom";
import "flow-core/tools/web/web-wait";

import "flow-core/tools/planner/index";

import "flow-core/tools/hyperframes/hyperframes-list";
import "flow-core/tools/hyperframes/hyperframes-init";
import "flow-core/tools/hyperframes/hyperframes-write";
import "flow-core/tools/hyperframes/hyperframes-edit";
import "flow-core/tools/hyperframes/hyperframes-read";
import "flow-core/tools/hyperframes/hyperframes-show";
import "flow-core/tools/hyperframes/hyperframes-validate";
import "flow-core/tools/hyperframes/hyperframes-remote-assets-explore";
import "flow-core/tools/hyperframes/hyperframes-remote-asset-import";

import "flow-core/tools/lottie/lottie-list";
import "flow-core/tools/lottie/lottie-init";
import "flow-core/tools/lottie/lottie-write";
import "flow-core/tools/lottie/lottie-edit";
import "flow-core/tools/lottie/lottie-read";
import "flow-core/tools/lottie/lottie-validate";
import "flow-core/tools/lottie/lottie-show";

toolRegistry.markDeprecatedByPrefix("container_", "sandbox_* grouped tools");
