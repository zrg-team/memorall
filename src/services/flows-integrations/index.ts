/**
 * flows-integrations — project-specific tools and steps that extend the
 * flows engine.  Each module self-registers with the flows registries on
 * import, so the main app only needs to import this file once.
 *
 * Architecture:
 *   - All interfaces are imported from flow-core/interfaces/*
 *   - All registrations go through flow-core/{tool,step}-registry
 *   - This package has no outward exports consumed by the engine itself
 */

// Service registry augmentation (must be first)
import "./services";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Co-agent browser-automation tools (Chrome extension only)
export * from "./tools/co-agent/index";

// Browser/Chrome DOM-dependent tools
import "./tools/js-execute";

// Co-agent and embedded-chat feature steps
import "./steps/features/co-agent-feature";
import "./steps/features/embedded-chat-feature";

// Document tools
import "./tools/files/doc-edit";
import "./tools/files/doc-move";
import "./tools/files/doc-read";
import "./tools/files/doc-remove";
import "./tools/files/doc-search";
import "./tools/files/doc-write";
import "./tools/files/excel-to-text";
import "./tools/files/pdf-generate";
import "./tools/files/pdf-metadata";
import "./tools/files/pdf-to-image";
import "./tools/files/pdf-to-text";

// Web tools that save to the document filesystem
import "./tools/web/web-fetch-image";
import "./tools/web/web-screenshot";

// Browser/virtual-server access tools
import "./tools/sandbox-container/container-web-access";

// Document filesystem tools (moved from flows-core)
import "./tools/files-fs/fs-glob";
import "./tools/files-fs/fs-grep";
import "./tools/files-fs/fs-read";
import "./tools/files-fs/fs-write";
import "./tools/files-fs/fs-edit";
import "./tools/files-fs/fs-mkdir";
import "./tools/files-fs/fs-remove";
import "./tools/files-fs/fs-ls";

// Feature step overrides — must come after core features are registered
import "./steps/features/hyperframes-feature";

// Document feature steps
import "./steps/features/fs-feature";
import "./steps/features/files-legacy-feature";
import "./steps/features/files-fs-feature";
import "./steps/features/document-convert-feature";
import "./steps/features/pdf-generate-feature";
