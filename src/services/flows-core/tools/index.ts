// Core tools — register on import
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import "@/services/flows-core/tools/calculator";
import "@/services/flows-core/tools/current-time";
import "@/services/flows-core/tools/load-skill";
import "@/services/flows-core/tools/send-message-to-agent";
import "@/services/flows-core/tools/thread-history";

import "@/services/flows-core/tools/fs/fs-glob";
import "@/services/flows-core/tools/fs/fs-grep";
import "@/services/flows-core/tools/fs/fs-read";
import "@/services/flows-core/tools/fs/fs-write";
import "@/services/flows-core/tools/fs/fs-edit";
import "@/services/flows-core/tools/fs/fs-mkdir";
import "@/services/flows-core/tools/fs/fs-remove";
import "@/services/flows-core/tools/fs/fs-ls";

import "@/services/flows-core/tools/sandbox-container/container-run-code";
import "@/services/flows-core/tools/sandbox-container/container-execute-command";
import "@/services/flows-core/tools/sandbox-container/container-listen-command";
import "@/services/flows-core/tools/sandbox-container/container-send-command-input";
import "@/services/flows-core/tools/sandbox-container/container-stop-command";
import "@/services/flows-core/tools/sandbox-container/container-list-commands";
import "@/services/flows-core/tools/sandbox-container/container-install-package";
import "@/services/flows-core/tools/sandbox-container/container-start-server";
import "@/services/flows-core/tools/sandbox-container/container-restart-server";
import "@/services/flows-core/tools/sandbox-container/container-stop-server";
import "@/services/flows-core/tools/sandbox-container/container-list-servers";
import "@/services/flows-core/tools/sandbox-container/container-get-logs";
import "@/services/flows-core/tools/sandbox-container/container-clear-logs";
import "@/services/flows-core/tools/sandbox-container/container-exists";
import "@/services/flows-core/tools/sandbox-container/container-fetch-resource";
import "@/services/flows-core/tools/sandbox-container/container-request-server";
import "@/services/flows-core/tools/sandbox-container/container-render-server";

import "@/services/flows-core/tools/agent-sandbox";

import "@/services/flows-core/tools/web/web-search-engine";
import "@/services/flows-core/tools/web/web-open";
import "@/services/flows-core/tools/web/web-read";
import "@/services/flows-core/tools/web/web-search";
import "@/services/flows-core/tools/web/web-dom";
import "@/services/flows-core/tools/web/web-wait";

import "@/services/flows-core/tools/planner/index";

import "@/services/flows-core/tools/hyperframes/hyperframes-list";
import "@/services/flows-core/tools/hyperframes/hyperframes-init";
import "@/services/flows-core/tools/hyperframes/hyperframes-write";
import "@/services/flows-core/tools/hyperframes/hyperframes-edit";
import "@/services/flows-core/tools/hyperframes/hyperframes-read";
import "@/services/flows-core/tools/hyperframes/hyperframes-show";
import "@/services/flows-core/tools/hyperframes/hyperframes-validate";
import "@/services/flows-core/tools/hyperframes/hyperframes-remote-assets-explore";
import "@/services/flows-core/tools/hyperframes/hyperframes-remote-asset-import";

import "@/services/flows-core/tools/lottie/lottie-list";
import "@/services/flows-core/tools/lottie/lottie-init";
import "@/services/flows-core/tools/lottie/lottie-write";
import "@/services/flows-core/tools/lottie/lottie-edit";
import "@/services/flows-core/tools/lottie/lottie-read";
import "@/services/flows-core/tools/lottie/lottie-validate";
import "@/services/flows-core/tools/lottie/lottie-show";

toolRegistry.markDeprecatedByPrefix("container_", "sandbox_* grouped tools");
