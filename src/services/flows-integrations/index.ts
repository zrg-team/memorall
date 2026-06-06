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
import "./tools/documents/doc-edit";
import "./tools/documents/doc-move";
import "./tools/documents/doc-read";
import "./tools/documents/doc-remove";
import "./tools/documents/doc-search";
import "./tools/documents/doc-write";
import "./tools/documents/excel-to-text";
import "./tools/documents/pdf-generate";
import "./tools/documents/pdf-metadata";
import "./tools/documents/pdf-to-image";
import "./tools/documents/pdf-to-text";

// Web tools that save to the document filesystem
import "./tools/web/web-fetch-image";
import "./tools/web/web-screenshot";

// Browser/virtual-server access tools
import "./tools/sandbox-container/container-web-access";

// Document filesystem tools (moved from flows-core)
import "./tools/documents-fs/fs-glob";
import "./tools/documents-fs/fs-grep";
import "./tools/documents-fs/fs-read";
import "./tools/documents-fs/fs-write";
import "./tools/documents-fs/fs-edit";
import "./tools/documents-fs/fs-mkdir";
import "./tools/documents-fs/fs-remove";
import "./tools/documents-fs/fs-ls";

// Feature step overrides — must come after core features are registered
import "./steps/features/hyperframes-feature";

// Document feature steps
import "./steps/features/fs-feature";
import "./steps/features/documents-feature";
import "./steps/features/documents-fs-feature";
import "./steps/features/document-convert-feature";
import "./steps/features/pdf-generate-feature";
