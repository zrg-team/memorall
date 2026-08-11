import { z } from "zod";
import type { BaseTool, HarnessPlugin } from "@memorall/agent-harness-core";
import {
  HTML_CONTENT_PROCESSOR,
  WEB_BROWSER_SERVICE,
  type WebSession,
} from "./contracts.js";

const asResult = (action: string, value: Record<string, unknown>) => ({
  content: JSON.stringify({ action, ...value }, null, 2),
  structuredContent: { actionType: action, ...value } as never,
});

export const createWebTools = (): BaseTool<any>[] => [
  {
    name: "web_open",
    description: "Open a URL in a provider-neutral web session.",
    schema: z.object({
      url: z.string().url(),
      presentation: z.string().optional(),
      persist: z.boolean().optional(),
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
    schema: z.object({
      sessionId: z.string().optional(),
      url: z.string().url().optional(),
      presentation: z.string().optional(),
      selector: z.string().optional(),
      contentMode: z.enum(["text", "html", "clean_html"]).optional(),
      maxChars: z.number().int().min(1).max(1_000_000).optional(),
    }).refine((value) => value.sessionId || value.url, { message: "sessionId or url is required" }),
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
      sessionId: z.string().min(1), pattern: z.string(), regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(), maxResults: z.number().int().min(1).max(500).optional(),
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
      operation: z.enum(["query", "action"]), sessionId: z.string().min(1), selector: z.string().min(1),
      action: z.string().optional(), value: z.string().optional(), index: z.number().int().min(0).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
    }),
    requiredServices: [WEB_BROWSER_SERVICE],
    execute: async ({ operation, sessionId, selector, action, value, index, maxResults }, { services }) => {
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
      sessionId: z.string().min(1), kind: z.enum(["render", "selector"]), selector: z.string().optional(),
      state: z.enum(["present", "absent"]).optional(), timeoutMs: z.number().int().min(1).max(120_000).optional(),
    }),
    requiredServices: [WEB_BROWSER_SERVICE],
    annotations: { readOnlyHint: true },
    execute: async (input, { services }) => {
      const output = await services.get(WEB_BROWSER_SERVICE).wait(input);
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
