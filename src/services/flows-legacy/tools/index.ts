// Core tools — register on import
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import "@/services/flows-legacy/tools/calculator";
import "@/services/flows-legacy/tools/current-time";
import "@/services/flows-legacy/tools/load-skill";
import "@/services/flows-legacy/tools/send-message-to-agent";
import "@/services/flows-legacy/tools/thread-history";

import "@/services/flows-legacy/tools/fs/fs-glob";
import "@/services/flows-legacy/tools/fs/fs-grep";
import "@/services/flows-legacy/tools/fs/fs-read";
import "@/services/flows-legacy/tools/fs/fs-write";
import "@/services/flows-legacy/tools/fs/fs-edit";
import "@/services/flows-legacy/tools/fs/fs-mkdir";
import "@/services/flows-legacy/tools/fs/fs-remove";
import "@/services/flows-legacy/tools/fs/fs-ls";

import "@/services/flows-legacy/tools/sandbox-container/container-run-code";
import "@/services/flows-legacy/tools/sandbox-container/container-execute-command";
import "@/services/flows-legacy/tools/sandbox-container/container-listen-command";
import "@/services/flows-legacy/tools/sandbox-container/container-send-command-input";
import "@/services/flows-legacy/tools/sandbox-container/container-stop-command";
import "@/services/flows-legacy/tools/sandbox-container/container-list-commands";
import "@/services/flows-legacy/tools/sandbox-container/container-install-package";
import "@/services/flows-legacy/tools/sandbox-container/container-start-server";
import "@/services/flows-legacy/tools/sandbox-container/container-restart-server";
import "@/services/flows-legacy/tools/sandbox-container/container-stop-server";
import "@/services/flows-legacy/tools/sandbox-container/container-list-servers";
import "@/services/flows-legacy/tools/sandbox-container/container-get-logs";
import "@/services/flows-legacy/tools/sandbox-container/container-clear-logs";
import "@/services/flows-legacy/tools/sandbox-container/container-exists";
import "@/services/flows-legacy/tools/sandbox-container/container-fetch-resource";
import "@/services/flows-legacy/tools/sandbox-container/container-request-server";
import "@/services/flows-legacy/tools/sandbox-container/container-render-server";

import "@/services/flows-legacy/tools/agent-sandbox";

import "@/services/flows-legacy/tools/web/web-search-engine";
import "@/services/flows-legacy/tools/web/web-open";
import "@/services/flows-legacy/tools/web/web-read";
import "@/services/flows-legacy/tools/web/web-search";
import "@/services/flows-legacy/tools/web/web-dom";
import "@/services/flows-legacy/tools/web/web-wait";

import "@/services/flows-legacy/tools/planner/index";

import "@/services/flows-legacy/tools/hyperframes/hyperframes-list";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-init";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-write";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-edit";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-read";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-show";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-validate";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-remote-assets-explore";
import "@/services/flows-legacy/tools/hyperframes/hyperframes-remote-asset-import";

import "@/services/flows-legacy/tools/lottie/lottie-list";
import "@/services/flows-legacy/tools/lottie/lottie-init";
import "@/services/flows-legacy/tools/lottie/lottie-write";
import "@/services/flows-legacy/tools/lottie/lottie-edit";
import "@/services/flows-legacy/tools/lottie/lottie-read";
import "@/services/flows-legacy/tools/lottie/lottie-validate";
import "@/services/flows-legacy/tools/lottie/lottie-show";

toolRegistry.markDeprecatedByPrefix("container_", "sandbox_* grouped tools");
