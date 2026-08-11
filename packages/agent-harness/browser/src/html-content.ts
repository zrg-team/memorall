import type { HtmlContentProcessor } from "@memorall/agent-harness-standard/web";

const clean = (element: Element): void => {
  for (const child of element.querySelectorAll("script, style, template, noscript")) child.remove();
  for (const node of element.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith("on") || attribute.name === "style") node.removeAttribute(attribute.name);
    }
  }
};

export class DomHtmlContentProcessor implements HtmlContentProcessor {
  extract(request: {
    html: string;
    text: string;
    selector?: string;
    mode: "text" | "html" | "clean_html";
    maxChars: number;
  }): { content: string; matchCount?: number } {
    const parsed = new DOMParser().parseFromString(request.html, "text/html");
    const matches = request.selector ? [...parsed.querySelectorAll(request.selector)] : [parsed.body];
    if (request.mode === "clean_html") for (const match of matches) clean(match);
    const content = matches.map((match) => request.mode === "text" ? match.textContent ?? "" : match.innerHTML).join("\n");
    return {
      content: content.slice(0, request.maxChars),
      ...(request.selector ? { matchCount: matches.length } : {}),
    };
  }
}
