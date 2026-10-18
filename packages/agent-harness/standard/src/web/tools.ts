import { z } from "zod";
import type { BaseTool, HarnessPlugin } from "@memorall/agent-harness-core";
import { optionalToolField, optionalToolBoolean, optionalToolInteger, optionalToolChoice, toolChoice } from "@memorall/agent-harness-core";
import {
  HTML_CONTENT_PROCESSOR,
  WEB_BROWSER_SERVICE,
  type WebSession,
} from "./contracts.js";

const asResult = (action: string, value: Record<string, unknown>) => ({
  content: JSON.stringify({ action, ...value }, null, 2),
  structuredContent: { actionType: action, ...value } as never,
});

const optionalString = () => optionalToolField(z.string().trim());
const readSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return input;
  const { url: _url, presentation: _presentation, ...sessionInput } = value;
  return sessionInput;
}, z.object({
  sessionId: optionalString(),
  url: optionalToolField(z.string().trim().url()),
  presentation: optionalString(),
  selector: optionalString(),
  contentMode: optionalToolChoice(["text", "html", "clean_html"]),
  maxChars: optionalToolInteger({ min: 1, max: 1_000_000 }),
}).refine((value) => value.sessionId || value.url, { message: "sessionId or url is required" }));

export const createWebTools = (): BaseTool<any>[] => [
  {
    name: "web_open",
    description: "Open a URL in a provider-neutral web session.",
    schema: z.object({
      url: z.string().trim().url(),
      presentation: optionalString(),
      persist: optionalToolBoolean(),
    }),
    requiredServices: [WEB_BROWSER_SERVICE],
    annotations: { openWorldHint: true },
    execute: async ({ url, presentation, persist }, { services, signal }) => {
      const opened = await services.get(WEB_BROWSER_SERVICE).open({ url, presentation, persist, signal });
      return asResult("web_open", { session: opened.session, disposable: opened.disposable });
    },
  },
  {
    name: "web_read",
    description: "Read text or HTML from a web session or URL.",
    schema: readSchema,
    requiredServices: [WEB_BROWSER_SERVICE],
    annotations: { readOnlyHint: true, openWorldHint: true },
    execute: async ({ sessionId, url, presentation, selector, contentMode = "text", maxChars = 100_000 }, { services, signal }) => {
      const browser = services.get(WEB_BROWSER_SERVICE);
      let session: WebSession;
      let disposable = false;
      if (sessionId) session = await browser.get(sessionId, signal);
      else {
        const opened = await browser.open({ url: url!, presentation, signal });
        session = opened.session;
        disposable = opened.disposable;
      }
      try {
        const processor = services.optional(HTML_CONTENT_PROCESSOR);
        const extracted = processor
          ? await processor.extract({ html: session.html, text: session.text, selector, mode: contentMode, maxChars })
          : { content: (contentMode === "text" ? session.text : session.html).slice(0, maxChars) };
        return asResult("web_read", {
          sessionId: session.id,
          url: session.currentUrl,
          title: session.title,
          domAccessible: session.domAccessible,
          contentMode,
          content: extracted.content,
          ...(extracted.matchCount === undefined ? {} : { matchCount: extracted.matchCount }),
        });
      } finally {
        if (disposable) await browser.close(session.id);
      }
    },
  },
  {
    name: "web_search",
    description: "Search rendered content in an existing web session.",
    schema: z.object({
      sessionId: z.string().trim().min(1), pattern: z.string(), regex: optionalToolBoolean(),
      caseSensitive: optionalToolBoolean(), maxResults: optionalToolInteger({ min: 1, max: 500 }),
    }),
    requiredServices: [WEB_BROWSER_SERVICE],
    annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
    execute: async (input, { services }) => {
      const matches = await services.get(WEB_BROWSER_SERVICE).search(input);
      return asResult("web_search", { sessionId: input.sessionId, matches });
    },
  },
  {
    name: "web_dom",
    description: "Query or interact with elements in a web session.",
    schema: z.object({
      operation: toolChoice(["query", "action"]), sessionId: z.string().trim().min(1), selector: optionalString(),
      action: optionalString(), value: optionalToolField(z.string(), { preserveBlank: true }), index: optionalToolInteger({ min: 0 }),
      maxResults: optionalToolInteger({ min: 1, max: 200 }),
    }).refine((value) => value.operation !== "action" || !["click", "input", "focus"].includes(value.action ?? "read") || Boolean(value.selector), { message: "A selector is required for click, input, and focus actions.", path: ["selector"] }),
    requiredServices: [WEB_BROWSER_SERVICE],
    execute: async ({ operation, sessionId, selector = "body", action, value, index, maxResults }, { services }) => {
      const browser = services.get(WEB_BROWSER_SERVICE);
      const output = operation === "query"
        ? await browser.query({ sessionId, selector, maxResults })
        : await browser.action({ sessionId, selector, action: action ?? "read", value, index });
      return asResult("web_dom", { operation, sessionId, output });
    },
  },
  {
    name: "web_wait",
    description: "Wait for page rendering or a selector state.",
    schema: z.object({
      sessionId: z.string().trim().min(1), kind: optionalToolChoice(["render", "selector"]), selector: optionalString(),
      state: optionalToolChoice(["present", "absent"]), timeoutMs: optionalToolInteger({ min: 1, max: 120_000 }),
    }).refine((value) => value.kind !== "selector" || Boolean(value.selector), { message: "A selector is required for selector waits.", path: ["selector"] }),
    requiredServices: [WEB_BROWSER_SERVICE],
    annotations: { readOnlyHint: true },
    execute: async (input, { services }) => {
      const output = await services.get(WEB_BROWSER_SERVICE).wait({ ...input, kind: input.kind ?? (input.selector ? "selector" : "render") });
      return asResult("web_wait", { sessionId: input.sessionId, output });
    },
  },
];

export const webPlugin = (): HarnessPlugin => ({
  id: "agent-harness.standard.web",
  version: "0.1.0",
  register: ({ registerTool }) => {
    for (const tool of createWebTools()) registerTool(tool.name, () => tool);
  },
});
