// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DomHtmlContentProcessor, createBrowserPlatform } from "../index.js";

describe("browser platform adapters", () => {
  it("provides injectable browser primitives and cancellable scheduling", async () => {
    const platform = createBrowserPlatform({ now: () => 42, randomUUID: () => "browser-id" });
    expect(platform.runtime).toBe("browser");
    expect(platform.now()).toBe(42);
    expect(platform.randomUUID()).toBe("browser-id");
    let called = false;
    const scheduled = platform.schedule(1, () => { called = true; });
    scheduled.cancel();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(called).toBe(false);
  });

  it("extracts selected text and removes executable or presentation markup", () => {
    const processor = new DomHtmlContentProcessor();
    const html = '<main><script>bad()</script><p style="color:red" onclick="bad()">Hello <strong>world</strong></p></main>';
    expect(processor.extract({ html, text: "", selector: "p", mode: "text", maxChars: 100 })).toEqual({ content: "Hello world", matchCount: 1 });
    const cleaned = processor.extract({ html, text: "", selector: "main", mode: "clean_html", maxChars: 1_000 });
    expect(cleaned.content).not.toContain("script");
    expect(cleaned.content).not.toContain("onclick");
    expect(cleaned.content).not.toContain("style=");
  });
});
